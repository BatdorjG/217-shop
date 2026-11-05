package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

type Server struct {
	db        *sql.DB
	js        jetstream.JetStream
	magicWord string
}

type Item struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Price    int    `json:"price"`
	Stock    int    `json:"stock"`
	ImageURL string `json:"image_url"`
}

type OrderReqItem struct {
	ItemID   int `json:"item_id"`
	Quantity int `json:"quantity"`
}

type CreateOrderReq struct {
	MagicWord  string         `json:"magic_word"`
	RoomNumber string         `json:"room_number"`
	Items      []OrderReqItem `json:"items"`
}

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	natsURL := os.Getenv("NATS_URL")
	magicWord := os.Getenv("MAGIC_WORD")
	if magicWord == "" {
		magicWord = "midnightramen"
	}

	// 1. Connect to PostgreSQL
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		log.Fatalf("Postgres open failed: %v", err)
	}
	defer db.Close()

	// 2. Connect to NATS JetStream (with retry for container startup)
	var nc *nats.Conn
	for i := 0; i < 10; i++ {
		nc, err = nats.Connect(natsURL)
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Fatalf("NATS connect failed: %v", err)
	}
	defer nc.Close()

	js, err := jetstream.New(nc)
	if err != nil {
		log.Fatalf("JetStream init failed: %v", err)
	}

	ctx := context.Background()
	_, err = js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:     "SHOP_EVENTS",
		Subjects: []string{"shop.orders.*", "shop.images.*"},
		Storage:  jetstream.FileStorage,
	})
	if err != nil {
		log.Fatalf("Stream creation failed: %v", err)
	}

	srv := &Server{db: db, js: js, magicWord: magicWord}

	// Start Background JetStream Consumer Worker
	go srv.startJetStreamWorker(ctx)

	// ==========================================
	// SHOPPER ROUTER (:8080 - Reached via frontend-shop)
	// ==========================================
	shopMux := http.NewServeMux()
	shopMux.HandleFunc("POST /api/shop/auth", srv.handleShopAuth)
	shopMux.HandleFunc("GET /api/shop/items", srv.handleShopGetItems)
	shopMux.HandleFunc("POST /api/shop/orders", srv.handleShopCreateOrder)
	shopMux.Handle("GET /uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("/app/uploads"))))

	// ==========================================
	// ADMIN ROUTER (:9090 - Reached via frontend-admin on Tailscale)
	// ==========================================
	adminMux := http.NewServeMux()
	adminMux.HandleFunc("GET /api/admin/items", srv.handleAdminGetItems)
	adminMux.HandleFunc("POST /api/admin/items", srv.handleAdminAddItem)
	adminMux.HandleFunc("PATCH /api/admin/items/{id}", srv.handleAdminUpdateItem)
	adminMux.HandleFunc("GET /api/admin/orders", srv.handleAdminGetOrders)
	adminMux.HandleFunc("POST /api/admin/orders/{id}/status", srv.handleAdminOrderStatus)
	adminMux.HandleFunc("GET /api/admin/bans", srv.handleAdminGetBans)
	adminMux.HandleFunc("POST /api/admin/bans", srv.handleAdminBanFootprint)
	adminMux.HandleFunc("DELETE /api/admin/bans/{hash}", srv.handleAdminUnbanFootprint)
	adminMux.Handle("GET /uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("/app/uploads"))))

	go func() {
		log.Println("🔒 Admin API listening internally on :9090")
		log.Fatal(http.ListenAndServe(":9090", adminMux))
	}()

	log.Println("🛒 Shopper API listening internally on :8080")
	log.Fatal(http.ListenAndServe(":8080", shopMux))
}

// Background JetStream Consumer
func (s *Server) startJetStreamWorker(ctx context.Context) {
	cons, err := s.js.CreateOrUpdateConsumer(ctx, "SHOP_EVENTS", jetstream.ConsumerConfig{
		Durable:   "shop_worker",
		AckPolicy: jetstream.AckExplicitPolicy,
	})
	if err != nil {
		log.Fatalf("Consumer error: %v", err)
	}

	_, err = cons.Consume(func(msg jetstream.Msg) {
		log.Printf("[NATS JETSTREAM] Event on %s: %s", msg.Subject(), string(msg.Data()))
		_ = msg.Ack()
	})
	if err != nil {
		log.Printf("Consume error: %v", err)
	}
}

func (s *Server) isBanned(ctx context.Context, footprint string) bool {
	var exists bool
	_ = s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM banned_footprints WHERE footprint_hash = $1)`, footprint).Scan(&exists)
	return exists
}

func (s *Server) handleShopAuth(w http.ResponseWriter, r *http.Request) {
	footprint := r.Header.Get("X-Device-Footprint")
	if s.isBanned(r.Context(), footprint) {
		http.Error(w, "Өмнө нь хуурамч захиалга өгсөн тул таны төхөөрөмжийг блоклосон байна.", http.StatusForbidden)
		return
	}

	var body struct {
		MagicWord string `json:"magic_word"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.MagicWord != s.magicWord {
		http.Error(w, "Нууц үг буруу байна.", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleShopGetItems(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Magic-Word") != s.magicWord {
		http.Error(w, "Нэвтрэх эрхгүй байна.", http.StatusUnauthorized)
		return
	}
	footprint := r.Header.Get("X-Device-Footprint")
	if s.isBanned(r.Context(), footprint) {
		http.Error(w, "Таны төхөөрөмж блоклогдсон байна.", http.StatusForbidden)
		return
	}

	rows, err := s.db.QueryContext(r.Context(), `SELECT id, name, price, stock, image_url FROM items WHERE stock > 0 ORDER BY id DESC`)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	items := []Item{}
	for rows.Next() {
		var it Item
		_ = rows.Scan(&it.ID, &it.Name, &it.Price, &it.Stock, &it.ImageURL)
		items = append(items, it)
	}
	writeJSON(w, http.StatusOK, items)
}

// ACID Transaction for Ordering to a Room
func (s *Server) handleShopCreateOrder(w http.ResponseWriter, r *http.Request) {
	footprint := r.Header.Get("X-Device-Footprint")
	if footprint == "" {
		http.Error(w, "Төхөөрөмжийн мэдээлэл олдсонгүй.", http.StatusBadRequest)
		return
	}
	if s.isBanned(r.Context(), footprint) {
		http.Error(w, "Таны төхөөрөмж захиалга өгөх эрхгүй (блоклогдсон) байна.", http.StatusForbidden)
		return
	}

	var req CreateOrderReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Хүсэлт буруу байна.", http.StatusBadRequest)
		return
	}
	if req.MagicWord != s.magicWord {
		http.Error(w, "Нууц үг буруу байна.", http.StatusUnauthorized)
		return
	}
	if req.RoomNumber == "" || len(req.Items) == 0 {
		http.Error(w, "Өрөөний дугаар болон бараагаа сонгоно уу.", http.StatusBadRequest)
		return
	}

	// Hash the IP as secondary metadata
	ipHash := sha256.Sum256([]byte(r.Header.Get("CF-Connecting-IP") + r.RemoteAddr))
	ipHashHex := hex.EncodeToString(ipHash[:8])

	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		http.Error(w, "Системийн алдаа гарлаа.", 500)
		return
	}
	defer tx.Rollback()

	totalPrice := 0
	type verifiedItem struct {
		id    int
		price int
		qty   int
	}
	var verified []verifiedItem

	// Lock each requested item row with FOR UPDATE so concurrent orders never oversell
	for _, reqIt := range req.Items {
		if reqIt.Quantity <= 0 {
			http.Error(w, "Тоо ширхэг буруу байна.", http.StatusBadRequest)
			return
		}
		var price, stock int
		err := tx.QueryRowContext(ctx, `SELECT price, stock FROM items WHERE id = $1 FOR UPDATE`, reqIt.ItemID).Scan(&price, &stock)
		if err != nil || stock < reqIt.Quantity {
			http.Error(w, fmt.Sprintf("#%d дугаартай барааны үлдэгдэл хүрэлцэхгүй байна.", reqIt.ItemID), http.StatusConflict)
			return
		}

		_, err = tx.ExecContext(ctx, `UPDATE items SET stock = stock - $1 WHERE id = $2`, reqIt.Quantity, reqIt.ItemID)
		if err != nil {
			http.Error(w, "Үлдэгдэл шинэчлэхэд алдаа гарлаа.", 500)
			return
		}

		totalPrice += price * reqIt.Quantity
		verified = append(verified, verifiedItem{id: reqIt.ItemID, price: price, qty: reqIt.Quantity})
	}

	var orderID int
	err = tx.QueryRowContext(ctx, `
		INSERT INTO orders (room_number, footprint_hash, ip_hash, total_price)
		VALUES ($1, $2, $3, $4) RETURNING id
	`, req.RoomNumber, footprint, ipHashHex, totalPrice).Scan(&orderID)
	if err != nil {
		http.Error(w, "Захиалга бүртгэхэд алдаа гарлаа.", 500)
		return
	}

	for _, v := range verified {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO order_items (order_id, item_id, quantity, price_at_order)
			VALUES ($1, $2, $3, $4)
		`, orderID, v.id, v.qty, v.price)
		if err != nil {
			http.Error(w, "Захиалгын бараа бүртгэхэд алдаа гарлаа.", 500)
			return
		}
	}

	// Commit ACID transaction
	if err := tx.Commit(); err != nil {
		http.Error(w, "Захиалга баталгаажуулахад алдаа гарлаа.", 500)
		return
	}

	// Publish to NATS JetStream
	eventData, _ := json.Marshal(map[string]any{
		"order_id":    orderID,
		"room_number": req.RoomNumber,
		"total_price": totalPrice,
		"footprint":   footprint,
	})
	_, _ = s.js.Publish(ctx, "shop.orders.created", eventData)

	writeJSON(w, http.StatusCreated, map[string]any{"order_id": orderID, "status": "pending"})
}

// ==========================================
// ADMIN HANDLERS
// ==========================================

func (s *Server) handleAdminGetItems(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, name, price, stock, image_url FROM items ORDER BY id DESC`)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	items := []Item{}
	for rows.Next() {
		var it Item
		_ = rows.Scan(&it.ID, &it.Name, &it.Price, &it.Stock, &it.ImageURL)
		items = append(items, it)
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleAdminAddItem(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseMultipartForm(20 << 20)
	name := r.FormValue("name")
	price, _ := strconv.Atoi(r.FormValue("price"))
	stock, _ := strconv.Atoi(r.FormValue("stock"))

	imageURL := ""
	file, header, err := r.FormFile("image")
	if err == nil {
		defer file.Close()
		filename := fmt.Sprintf("%d%s", time.Now().UnixNano(), filepath.Ext(header.Filename))
		dstPath := filepath.Join("/app/uploads", filename)
		if dst, err := os.Create(dstPath); err == nil {
			_, _ = io.Copy(dst, file)
			dst.Close()
			imageURL = "/uploads/" + filename
		}
	}

	var id int
	err = s.db.QueryRowContext(r.Context(), `
		INSERT INTO items (name, price, stock, image_url) VALUES ($1, $2, $3, $4) RETURNING id
	`, name, price, stock, imageURL).Scan(&id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	_, _ = s.js.Publish(r.Context(), "shop.images.uploaded", []byte(fmt.Sprintf(`{"item_id":%d}`, id)))
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (s *Server) handleAdminUpdateItem(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Name  string `json:"name"`
		Price int    `json:"price"`
		Stock int    `json:"stock"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid JSON", 400)
		return
	}
	_, err := s.db.ExecContext(r.Context(), `UPDATE items SET name=$1, price=$2, stock=$3 WHERE id=$4`,
		body.Name, body.Price, body.Stock, id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (s *Server) handleAdminGetOrders(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT o.id, o.room_number, o.footprint_hash, o.status, o.total_price, o.created_at,
		       COALESCE(json_agg(json_build_object('name', i.name, 'qty', oi.quantity)), '[]')
		FROM orders o
		LEFT JOIN order_items oi ON oi.order_id = o.id
		LEFT JOIN items i ON i.id = oi.item_id
		GROUP BY o.id
		ORDER BY o.id DESC LIMIT 50
	`)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	var result []map[string]any
	for rows.Next() {
		var id, total int
		var room, fp, status, itemsJSON string
		var created time.Time
		_ = rows.Scan(&id, &room, &fp, &status, &total, &created, &itemsJSON)
		var items any
		_ = json.Unmarshal([]byte(itemsJSON), &items)
		result = append(result, map[string]any{
			"id":             id,
			"room_number":    room,
			"footprint_hash": fp,
			"status":         status,
			"total_price":    total,
			"created_at":     created.Format("15:04:05"),
			"items":          items,
		})
	}
	writeJSON(w, http.StatusOK, result)
}

// Marks an order as "delivered" OR "false_order" (which restores item stock and bans the user's footprint in one ACID transaction!)
func (s *Server) handleAdminOrderStatus(w http.ResponseWriter, r *http.Request) {
	orderID := r.PathValue("id")
	var body struct {
		Status string `json:"status"` // "delivered" or "false_order"
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer tx.Rollback()

	var footprint, oldStatus, room string
	err = tx.QueryRowContext(ctx, `SELECT footprint_hash, status, room_number FROM orders WHERE id = $1 FOR UPDATE`, orderID).
		Scan(&footprint, &oldStatus, &room)
	if err != nil {
		http.Error(w, "Захиалга олдсонгүй", 404)
		return
	}

	_, _ = tx.ExecContext(ctx, `UPDATE orders SET status = $1 WHERE id = $2`, body.Status, orderID)

	// If roommate marks it as a FALSE ORDER: restore stock + ban footprint automatically
	if body.Status == "false_order" && oldStatus != "false_order" {
		_, _ = tx.ExecContext(ctx, `
			UPDATE items i
			SET stock = i.stock + oi.quantity
			FROM order_items oi
			WHERE oi.order_id = $1 AND oi.item_id = i.id
		`, orderID)

		_, _ = tx.ExecContext(ctx, `
			INSERT INTO banned_footprints (footprint_hash, reason)
			VALUES ($1, $2) ON CONFLICT DO NOTHING
		`, footprint, room+" тоот руу хуурамч захиалга өгсөн")
	}

	_ = tx.Commit()
	writeJSON(w, http.StatusOK, map[string]string{"status": body.Status})
}

func (s *Server) handleAdminGetBans(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT footprint_hash, reason, banned_at FROM banned_footprints ORDER BY banned_at DESC`)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	var bans []map[string]any
	for rows.Next() {
		var hash, reason string
		var bannedAt time.Time
		_ = rows.Scan(&hash, &reason, &bannedAt)
		bans = append(bans, map[string]any{"footprint_hash": hash, "reason": reason, "banned_at": bannedAt.Format("2006-01-02 15:04")})
	}
	writeJSON(w, http.StatusOK, bans)
}

func (s *Server) handleAdminBanFootprint(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FootprintHash string `json:"footprint_hash"`
		Reason        string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	_, err := s.db.ExecContext(r.Context(), `INSERT INTO banned_footprints (footprint_hash, reason) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		body.FootprintHash, body.Reason)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "banned"})
}

func (s *Server) handleAdminUnbanFootprint(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	_, _ = s.db.ExecContext(r.Context(), `DELETE FROM banned_footprints WHERE footprint_hash = $1`, hash)
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
