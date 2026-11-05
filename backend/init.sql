-- Items in the shop
CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    image_url TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Banned device footprints
CREATE TABLE banned_footprints (
    footprint_hash TEXT PRIMARY KEY,
    reason TEXT NOT NULL DEFAULT 'False order / wrong room',
    banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Orders placed to a room
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    room_number TEXT NOT NULL,
    footprint_hash TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, delivered, false_order
    total_price INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Line items inside an order (ACID relation)
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price_at_order INTEGER NOT NULL
);

CREATE INDEX idx_orders_footprint ON orders(footprint_hash);
CREATE INDEX idx_items_stock ON items(stock) WHERE stock > 0;
