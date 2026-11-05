FROM golang:1.23-alpine AS builder
WORKDIR /src
COPY go.mod ./
COPY main.go ./
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /shop-server .

FROM alpine:3.20
WORKDIR /app
RUN mkdir -p /app/uploads
COPY --from=builder /shop-server /app/shop-server
EXPOSE 8080 9090
CMD ["/app/shop-server"]
