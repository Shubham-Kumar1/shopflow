# ShopFlow Backend — Microservices E-Commerce Platform

A production-ready Node.js microservices backend for an e-commerce platform, featuring event-driven architecture with Apache Kafka and RabbitMQ, JWT authentication, and PostgreSQL/MongoDB/Redis data stores.

> **Frontend repo:** [shopflow-frontend](../shopflow-frontend)

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Infrastructure Components](#infrastructure-components)
- [Service Components](#service-components)
  - [API Gateway](#1-api-gateway-port-4000)
  - [User Service](#2-user-service-port-4001)
  - [Product Service](#3-product-service-port-4002)
  - [Order Service](#4-order-service-port-4003)
  - [Payment Service](#5-payment-service-port-4004)
  - [Notification Service](#6-notification-service-port-4005)
- [API Reference](#api-reference)
- [Messaging & Event Flow](#messaging--event-flow)
- [Environment Variables](#environment-variables)
- [Docker Setup](#docker-setup)
- [Seeding Data](#seeding-data)
- [Monitoring & Observability](#monitoring--observability)
- [Stopping the Application](#stopping-the-application)

---

## Architecture

```
                                    ┌─────────────────┐
                                    │   Frontend       │
                                    │   (separate repo)│
                                    │   :3000          │
                                    └────────┬────────┘
                                             │ HTTP
                                    ┌────────▼────────┐
                                    │   API Gateway    │
                                    │   :4000          │
                                    │  JWT · Proxy     │
                                    │  Rate Limiting   │
                                    └──┬──┬──┬──┬─────┘
                       ┌───────────────┘  │  │  └───────────────┐
                       ▼                  ▼  ▼                  ▼
              ┌──────────────┐  ┌──────────────┐  ┌───────────────┐
              │ User Service │  │   Product    │  │   Payment     │
              │ :4001        │  │   Service    │  │   Service     │
              │              │  │   :4002      │  │   :4004       │
              │ PostgreSQL   │  │              │  │               │
              │ + Redis      │  │ MongoDB      │  │ PostgreSQL    │
              └──────────────┘  │ + Redis      │  │ + Kafka       │
                                └──────────────┘  │ + RabbitMQ    │
                                                  └──────┬────────┘
              ┌──────────────┐                           │
              │ Order Service│◄──── Kafka ───────────────┘
              │ :4003        │   payment-events
              │              │
              │ PostgreSQL   │         ┌──────────────────┐
              │ + Kafka      │────────►│  Notification    │
              └──────────────┘         │  Service :4005   │
                  order-events         │  (Kafka+RabbitMQ)│
                                       └──────────────────┘
```

**Request flow:** All client requests go through the API Gateway (`:4000`), which authenticates via JWT, rate-limits, and proxies to the appropriate downstream service.

**Event flow:** Services communicate asynchronously through Kafka (order/payment events) and RabbitMQ (payment job processing). The Notification Service listens to both.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker | >= 20.x | Container runtime |
| Docker Compose | >= 2.x | Multi-container orchestration |
| Node.js | >= 20.x | Local development only (optional) |

---

## Quick Start

```bash
# 1. Clone and enter the project
git clone <repo-url>
cd shopflow

# 2. Set up environment variables
cp .env.example .env

# 3. Start everything (infra + all 6 services)
docker compose up -d --build

# 4. Wait ~60 seconds for all services to become healthy
docker compose ps   # Check all show "healthy" or "running"

# 5. Seed the product catalog (20 products)
docker exec shopflow-product-service node src/seed.js

# 6. Verify
curl http://localhost:4000/health
# → {"status":"ok","timestamp":"...","service":"api-gateway"}
```

---

## Infrastructure Components

These are the data stores and messaging systems that the microservices depend on.

### PostgreSQL (`postgres:15-alpine`)

| Property | Value |
|----------|-------|
| Port | 5432 |
| User | `shopflow` |
| Password | `shopflow123` |
| Databases | `users_db`, `orders_db`, `payments_db` |

Three databases are auto-created on first start by the init script at `infra/postgres/init-multiple-dbs.sh`. This script reads the `POSTGRES_MULTIPLE_DATABASES` environment variable and creates each database, granting full privileges to the configured user.

### MongoDB (`mongo:6-jammy`)

| Property | Value |
|----------|-------|
| Port | 27017 |
| User | `shopflow` |
| Password | `shopflow123` |
| Database | `products_db` |

Stores the product catalog using Mongoose schemas with text indexes for search.

### Redis (`redis:7-alpine`)

| Property | Value |
|----------|-------|
| Port | 6379 |

Used for two purposes:
- **Session storage** — Refresh tokens stored with key `refresh:<userId>` (7-day TTL)
- **Product caching** — Individual products cached with key `product:<id>` (5-minute TTL)

### Apache Kafka (`confluentinc/cp-kafka:7.4.0`)

| Property | Value |
|----------|-------|
| External Port | 9092 (localhost) |
| Internal Port | 29092 (inter-container) |
| Depends on | Zookeeper (:2181) |
| Topics | `order-events`, `payment-events` |

Handles asynchronous event streaming between Order, Payment, and Notification services.

### Kafka UI (`provectuslabs/kafka-ui`)

| Property | Value |
|----------|-------|
| Port | 8080 |
| URL | http://localhost:8080 |

Web UI for browsing Kafka topics, messages, and consumer groups. Useful for debugging event flow.

### RabbitMQ (`rabbitmq:3.12-management-alpine`)

| Property | Value |
|----------|-------|
| AMQP Port | 5672 |
| Management UI | 15672 |
| User | `shopflow` |
| Password | `shopflow123` |
| URL | http://localhost:15672 |

Handles payment job processing with:
- **Exchange:** `payment.exchange` (direct type)
- **Queues:** `payment.process`, `payment.notifications`, `payment.dlq`

---

## Service Components

All services share these conventions:
- **Logging:** Winston with structured JSON output and `service` field
- **Metrics:** `prom-client` exposing Prometheus metrics at `GET /metrics`
- **Health:** `GET /health` → `{ status: "ok", timestamp, service }`
- **Security:** `helmet` + `cors` on every service
- **Response shape:** `{ data, message, error }`
- **Graceful shutdown:** Listens for `SIGTERM`/`SIGINT`, closes all connections cleanly

---

### 1. API Gateway (Port 4000)

**Purpose:** Single entry point for all client requests. Handles authentication, rate limiting, and proxying.

**Directory:** `services/api-gateway/`

```
src/
├── index.js              # Express app, proxy setup, middleware chain
├── middleware/
│   ├── auth.js           # JWT verification, public route whitelist
│   └── rateLimiter.js    # Three-tier rate limiting
└── utils/
    ├── logger.js         # Winston JSON logger
    └── metrics.js        # Prometheus metrics + HTTP duration histogram
```

#### How It Works

1. Every request hits the gateway first
2. `helmet` and `cors` are applied globally
3. Rate limiters are checked (see below)
4. JWT auth middleware verifies the token (unless the route is public)
5. On valid JWT, `x-user-id` and `x-user-role` headers are injected into the request
6. The request is proxied to the appropriate downstream service via `http-proxy-middleware`

#### Proxy Routes

| Path Pattern | Downstream Service |
|---|---|
| `/api/users/*` | `http://user-service:4001` |
| `/api/products/*` | `http://product-service:4002` |
| `/api/orders/*` | `http://order-service:4003` |
| `/api/payments/*` | `http://payment-service:4004` |

#### Public Routes (no JWT required)

- `POST /api/users/register`
- `POST /api/users/login`
- `POST /api/users/refresh`
- `POST /api/payments/webhook`
- `GET /api/products` and `GET /api/products/*`
- `GET /health`, `GET /metrics`

#### Rate Limiting

| Limiter | Scope | Limit |
|---------|-------|-------|
| Global | All requests | 300 requests / 15 minutes |
| Auth | `/api/users/login`, `/api/users/register` | 20 requests / 15 minutes |
| Orders | `/api/orders` | 10 requests / 1 minute |

---

### 2. User Service (Port 4001)

**Purpose:** User registration, authentication, and profile management.

**Database:** PostgreSQL (`users_db`) + Redis (refresh tokens)

**Directory:** `services/user-service/`

```
src/
├── index.js              # Express app, DB init, route mounting
├── routes/
│   └── users.js          # All user endpoints + Redis client
├── models/
│   └── User.js           # PostgreSQL schema + query helpers
├── middleware/
│   └── validate.js       # express-validator result checker
└── utils/
    └── logger.js
```

#### Database Schema — `users` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Auto-generated primary key |
| `email` | VARCHAR(255) | Unique, required |
| `password_hash` | VARCHAR(255) | bcrypt, 12 salt rounds |
| `first_name` | VARCHAR(100) | Optional |
| `last_name` | VARCHAR(100) | Optional |
| `role` | VARCHAR(50) | Default: `customer` |
| `created_at` | TIMESTAMP | Auto-set |
| `updated_at` | TIMESTAMP | Auto-set |

The table is auto-created on service startup via the `init()` function.

#### Authentication Flow

1. **Register:** Client sends email + password → password hashed with bcrypt (12 rounds) → user created → access token (15m) + refresh token (7d) returned
2. **Login:** Email + password verified → new token pair issued → refresh token stored in Redis
3. **Accessing protected routes:** Client sends `Authorization: Bearer <accessToken>` → Gateway verifies JWT → injects `x-user-id` header → downstream service reads the header
4. **Token refresh:** Client sends refresh token → service verifies it against Redis → new access token issued

#### Endpoints

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| `POST` | `/api/users/register` | Public | `{ email, password, firstName?, lastName? }` | Register. Password must be ≥ 8 chars. Returns `{ user, accessToken, refreshToken }` |
| `POST` | `/api/users/login` | Public | `{ email, password }` | Login. Returns `{ user, accessToken, refreshToken }` |
| `GET` | `/api/users/profile` | JWT | — | Returns user data from `x-user-id` header |
| `PUT` | `/api/users/profile` | JWT | `{ firstName, lastName }` | Updates name fields |
| `POST` | `/api/users/refresh` | Public | `{ refreshToken }` | Validates against Redis, returns new `{ accessToken }` |

---

### 3. Product Service (Port 4002)

**Purpose:** Product catalog CRUD, search, filtering, and caching.

**Database:** MongoDB (`products_db`) + Redis (product cache)

**Directory:** `services/product-service/`

```
src/
├── index.js              # Express app, MongoDB + Redis connections
├── routes/
│   └── products.js       # All product endpoints + Redis caching
├── models/
│   └── Product.js        # Mongoose schema with text index
├── seed.js               # Seeds 20 sample products
└── utils/
    └── logger.js
```

#### Mongoose Schema — `Product`

| Field | Type | Notes |
|-------|------|-------|
| `name` | String | Required, text-indexed for search |
| `description` | String | — |
| `price` | Number | Required, min: 0 |
| `category` | String | Required, indexed |
| `stock` | Number | Default: 0, min: 0 |
| `images` | [String] | Array of image URLs |
| `sku` | String | Unique |
| `ratings.average` | Number | Default: 0 |
| `ratings.count` | Number | Default: 0 |
| `isActive` | Boolean | Default: true (soft delete flag) |
| `createdAt` | Date | Auto-set |

#### Redis Caching

- Individual products are cached with key `product:<id>` and a **5-minute TTL**
- Cache is invalidated on update, delete, or stock change

#### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/products` | Public | List products with pagination and filters |
| `GET` | `/api/products/:id` | Public | Single product (cached) |
| `POST` | `/api/products` | Admin | Create a product |
| `PUT` | `/api/products/:id` | Admin | Update a product |
| `DELETE` | `/api/products/:id` | Admin | Soft delete (`isActive: false`) |
| `PATCH` | `/api/products/:id/stock` | JWT | Decrement stock atomically |

#### Query Parameters for `GET /api/products`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 12 | Items per page (max 100) |
| `category` | string | — | Filter by category name |
| `search` | string | — | Full-text search on product name |
| `minPrice` | number | — | Minimum price filter |
| `maxPrice` | number | — | Maximum price filter |
| `sort` | string | `newest` | Sort: `price_asc`, `price_desc`, `newest` |

**Response format:**
```json
{
  "data": {
    "products": [ ... ],
    "pagination": { "page": 1, "limit": 12, "total": 20, "pages": 2 }
  }
}
```

#### Seed Data

The seed script (`src/seed.js`) inserts 20 products across 4 categories:

| Category | Example Products |
|----------|-----------------|
| Electronics | Wireless Bluetooth Headphones, 4K Monitor, Mechanical Keyboard, Portable SSD, Fitness Tracker |
| Clothing | Denim Jacket, Merino Wool Sweater, Running Shoes, Cotton T-Shirt Pack, Hiking Boots |
| Books | The Art of Clean Code, Data Structures & Algorithms, Modern DevOps Practices, and more |
| Home & Garden | LED Desk Lamp, Herb Garden Kit, Cookware Set, Robotic Vacuum, Bathroom Organizer |

Run it: `docker exec shopflow-product-service node src/seed.js`

---

### 4. Order Service (Port 4003)

**Purpose:** Order creation, retrieval, cancellation, and status management via Kafka events.

**Database:** PostgreSQL (`orders_db`)

**Messaging:** Kafka (producer + consumer)

**Directory:** `services/order-service/`

```
src/
├── index.js              # Express app, DB init, Kafka connection with retry
├── routes/
│   └── orders.js         # Order endpoints
├── models/
│   └── Order.js          # PostgreSQL schema + query helpers
├── kafka/
│   ├── producer.js       # Publishes to 'order-events'
│   └── consumer.js       # Consumes from 'payment-events'
└── utils/
    └── logger.js
```

#### Database Schema

**`orders` table:**

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Auto-generated |
| `user_id` | UUID | Owner |
| `status` | VARCHAR(50) | `pending` → `confirmed` → `processing` → `shipped` → `delivered` / `cancelled` |
| `total_amount` | DECIMAL(10,2) | Calculated from items |
| `shipping_address` | JSONB | `{ firstName, lastName, address, city, state, zipCode, country }` |
| `created_at` | TIMESTAMP | Auto-set |
| `updated_at` | TIMESTAMP | Auto-set |

**`order_items` table:**

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Auto-generated |
| `order_id` | UUID | Foreign key → orders (CASCADE delete) |
| `product_id` | VARCHAR(255) | MongoDB product ID |
| `product_name` | VARCHAR(255) | Snapshot of product name |
| `quantity` | INTEGER | — |
| `unit_price` | DECIMAL(10,2) | Snapshot of price at time of order |

#### Kafka Integration

**Producer** — When an order is created, publishes to topic `order-events`:
```json
{
  "eventType": "ORDER_PLACED",
  "orderId": "uuid",
  "userId": "uuid",
  "items": [{ "productId": "...", "quantity": 2 }],
  "totalAmount": 149.99,
  "timestamp": "2026-03-06T..."
}
```

**Consumer** (group: `order-service-group`) — Subscribes to `payment-events`:
- `PAYMENT_CONFIRMED` → Updates order status to `confirmed`
- `PAYMENT_FAILED` → Updates order status to `cancelled`

#### Endpoints

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| `POST` | `/api/orders` | JWT | `{ items[], shippingAddress }` | Creates order + publishes Kafka event |
| `GET` | `/api/orders` | JWT | — | List all orders for the authenticated user (includes items) |
| `GET` | `/api/orders/:id` | JWT | — | Single order with items (ownership verified) |
| `PATCH` | `/api/orders/:id/cancel` | JWT | — | Cancel if status is `pending` |

**Order item format in POST body:**
```json
{
  "items": [
    { "productId": "mongo_id", "productName": "Widget", "quantity": 2, "unitPrice": 29.99 }
  ],
  "shippingAddress": {
    "firstName": "Jane", "lastName": "Doe",
    "address": "123 Main St", "city": "NYC", "state": "NY",
    "zipCode": "10001", "country": "US"
  }
}
```

---

### 5. Payment Service (Port 4004)

**Purpose:** Payment initiation, simulated processing via RabbitMQ, and webhook handling.

**Database:** PostgreSQL (`payments_db`)

**Messaging:** Kafka (producer) + RabbitMQ (publisher + consumer)

**Directory:** `services/payment-service/`

```
src/
├── index.js              # Express app, DB/Kafka/RabbitMQ connections with retry
├── routes/
│   └── payments.js       # Payment endpoints
├── models/
│   └── Payment.js        # PostgreSQL schema + query helpers
├── kafka/
│   └── producer.js       # Publishes to 'payment-events'
├── rabbitmq/
│   ├── publisher.js      # Exchange + queue setup, publishes jobs
│   └── consumer.js       # Simulated payment processing
└── utils/
    └── logger.js
```

#### Database Schema — `payments` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Auto-generated |
| `order_id` | UUID | — |
| `user_id` | UUID | — |
| `amount` | DECIMAL(10,2) | — |
| `status` | VARCHAR(50) | `pending` → `processing` → `completed` / `failed` / `refunded` |
| `payment_method` | VARCHAR(50) | e.g., `card` |
| `stripe_payment_id` | VARCHAR(255) | Populated by webhook |
| `created_at` | TIMESTAMP | Auto-set |
| `updated_at` | TIMESTAMP | Auto-set |

#### RabbitMQ Setup

```
payment.exchange (direct)
├── routing key: payment.process  →  queue: payment.process
│                                    (DLQ: payment.dlq after 3 retries)
└── routing key: payment.notifications → queue: payment.notifications
```

**When a payment is initiated:**
1. A payment record is created in the database (status: `pending`)
2. A job is published to both `payment.process` and `payment.notifications` routing keys

**The consumer (`rabbitmq/consumer.js`) simulates processing:**
- **85% chance:** Success → status updated to `completed` → Kafka `PAYMENT_CONFIRMED` published
- **15% chance:** Failure → retried up to 3 times with exponential backoff (2s, 4s, 8s) → after max retries: status updated to `failed` → message sent to DLQ → Kafka `PAYMENT_FAILED` published

#### Endpoints

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| `POST` | `/api/payments/initiate` | JWT | `{ orderId, amount, paymentMethod }` | Create payment + publish RabbitMQ job |
| `GET` | `/api/payments/:orderId` | JWT | — | Get payment status for an order |
| `POST` | `/api/payments/webhook` | Public | `{ paymentId, status, stripePaymentId? }` | Simulate a Stripe webhook callback |

---

### 6. Notification Service (Port 4005)

**Purpose:** Event-driven notification logging. No database — purely reactive.

**Messaging:** Kafka (consumer) + RabbitMQ (consumer)

**Directory:** `services/notification-service/`

```
src/
├── index.js              # Express app, Kafka/RabbitMQ connections with retry
├── kafka/
│   └── consumer.js       # Listens to order-events + payment-events
├── rabbitmq/
│   └── consumer.js       # Listens to payment.notifications
└── utils/
    └── logger.js
```

#### Events Consumed

**Kafka** (consumer group: `notification-service-kafka-group`):

| Topic | Event | Log Output |
|-------|-------|------------|
| `order-events` | `ORDER_PLACED` | `[NOTIFICATION] 📦 Order placed - Order #<id> for user <userId> — $<amount>` |
| `payment-events` | `PAYMENT_CONFIRMED` | `[NOTIFICATION] ✅ Payment confirmed - Order #<id> is now confirmed. Email sent to user <userId>.` |
| `payment-events` | `PAYMENT_FAILED` | `[NOTIFICATION] ❌ Payment failed - Order #<id> has been cancelled. User <userId> notified.` |

**RabbitMQ** (queue: `notification.payments`, bound to `payment.exchange` → `payment.notifications`):

| Event | Log Output |
|-------|------------|
| Payment job received | `[NOTIFICATION] 💳 Processing payment of $<amount> for order <orderId>` |

View logs: `docker logs -f shopflow-notification-service`

---

## API Reference

All endpoints are accessed through the API Gateway at `http://localhost:4000`.

### User Service

```
POST /api/users/register     ← Public    { email, password, firstName?, lastName? }
POST /api/users/login        ← Public    { email, password }
POST /api/users/refresh      ← Public    { refreshToken }
GET  /api/users/profile      ← JWT
PUT  /api/users/profile      ← JWT       { firstName, lastName }
```

### Product Service

```
GET    /api/products              ← Public   ?page, limit, category, search, minPrice, maxPrice, sort
GET    /api/products/:id          ← Public
POST   /api/products              ← Admin    { name, price, category, description?, stock?, sku?, images? }
PUT    /api/products/:id          ← Admin    { ...fields to update }
DELETE /api/products/:id          ← Admin    (soft delete)
PATCH  /api/products/:id/stock    ← JWT      { quantity }
```

### Order Service

```
POST  /api/orders              ← JWT    { items: [{ productId, productName, quantity, unitPrice }], shippingAddress }
GET   /api/orders              ← JWT
GET   /api/orders/:id          ← JWT
PATCH /api/orders/:id/cancel   ← JWT    (only for "pending" orders)
```

### Payment Service

```
POST /api/payments/initiate    ← JWT      { orderId, amount, paymentMethod }
GET  /api/payments/:orderId    ← JWT
POST /api/payments/webhook     ← Public   { paymentId, status, stripePaymentId? }
```

---

## Messaging & Event Flow

### Complete Order-to-Payment Flow

```
Customer places order
        │
        ▼
┌─ Order Service ─────────────────────────────┐
│  1. Create order in PostgreSQL (pending)     │
│  2. Publish ORDER_PLACED → Kafka             │
└──────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
  Notification Service          Customer calls
  logs "Order placed"           POST /api/payments/initiate
                                       │
                                       ▼
                    ┌─ Payment Service ──────────────────────┐
                    │  3. Create payment record (pending)    │
                    │  4. Publish job → RabbitMQ             │
                    └────────────────────────────────────────┘
                               │                    │
                    payment.process          payment.notifications
                               │                    │
                               ▼                    ▼
                    ┌─ Payment Consumer ─┐   Notification Service
                    │  5. Simulate       │   logs "Processing..."
                    │     processing     │
                    │                    │
                    │  85% → completed   │
                    │  15% → retry/fail  │
                    └──────────┬─────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
        PAYMENT_CONFIRMED              PAYMENT_FAILED
          → Kafka                        → Kafka
                │                             │
        ┌───────┴───────┐             ┌───────┴───────┐
        ▼               ▼             ▼               ▼
  Order Service    Notification   Order Service   Notification
  status →         Service        status →        Service
  "confirmed"      logs ✅        "cancelled"     logs ❌
```

### Kafka Topics

| Topic | Producers | Consumers |
|-------|-----------|-----------|
| `order-events` | Order Service | Notification Service |
| `payment-events` | Payment Service | Order Service, Notification Service |

### RabbitMQ Queues

| Queue | Exchange | Routing Key | Consumer |
|-------|----------|-------------|----------|
| `payment.process` | `payment.exchange` | `payment.process` | Payment Service (simulated processing) |
| `payment.notifications` | `payment.exchange` | `payment.notifications` | Notification Service |
| `payment.dlq` | (default) | `payment.dlq` | Dead letter queue for failed payments |

---

## Environment Variables

### `.env.example`

```env
# PostgreSQL
POSTGRES_USER=shopflow
POSTGRES_PASSWORD=shopflow123

# MongoDB
MONGO_INITDB_ROOT_USERNAME=shopflow
MONGO_INITDB_ROOT_PASSWORD=shopflow123

# JWT
JWT_SECRET=your_super_secret_jwt_key_change_in_production

# RabbitMQ
RABBITMQ_DEFAULT_USER=shopflow
RABBITMQ_DEFAULT_PASS=shopflow123

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:4000
```

### Per-Service Environment (set in docker-compose.yml)

| Variable | Used By | Value |
|----------|---------|-------|
| `PORT` | All services | 4000–4005 |
| `JWT_SECRET` | Gateway, User Service | Shared signing key |
| `DATABASE_URL` | User, Order, Payment | PostgreSQL connection string |
| `MONGODB_URI` | Product Service | MongoDB connection string |
| `REDIS_URL` | User, Product Service | Redis connection string |
| `KAFKA_BROKERS` | Order, Payment, Notification | `kafka:29092` |
| `RABBITMQ_URL` | Payment, Notification | `amqp://shopflow:shopflow123@rabbitmq:5672` |

---

## Docker Setup

### Dockerfiles

All backend services use identical multi-stage Dockerfiles:

```dockerfile
# Stage 1: Install production dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# Stage 2: Runtime
FROM node:20-alpine AS runtime
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json ./
USER app
EXPOSE <PORT>
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:<PORT>/health || exit 1
CMD ["node", "src/index.js"]
```

Key features:
- **Multi-stage** — separates dependency installation from runtime
- **Non-root user** — runs as `app` user for security
- **Health check** — Docker monitors service health via `/health` endpoint
- **Minimal image** — Alpine-based (~180MB per service)

### Service URLs

| Service | URL |
|---------|-----|
| API Gateway | http://localhost:4000 |
| User Service | http://localhost:4001 |
| Product Service | http://localhost:4002 |
| Order Service | http://localhost:4003 |
| Payment Service | http://localhost:4004 |
| Notification Service | http://localhost:4005 |
| Kafka UI | http://localhost:8080 |
| RabbitMQ Management | http://localhost:15672 |

---

## Seeding Data

```bash
# Seed 20 products across 4 categories
docker exec shopflow-product-service node src/seed.js
```

This clears existing products and inserts 20 fresh ones. Safe to run multiple times.

---

## Monitoring & Observability

### Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f payment-service
docker compose logs -f notification-service

# Filter for notifications
docker logs shopflow-notification-service 2>&1 | grep "NOTIFICATION"
```

### Prometheus Metrics

Every service exposes `GET /metrics` with default Node.js metrics + custom HTTP duration histogram.

```bash
curl http://localhost:4000/metrics
```

### Kafka UI

Browse topics, messages, and consumer groups at **http://localhost:8080**.

### RabbitMQ Management

Monitor queues, exchanges, and message rates at **http://localhost:15672** (login: `shopflow` / `shopflow123`).

---

## Stopping the Application

```bash
# Stop all containers
docker compose down

# Stop and remove all data (volumes)
docker compose down -v
```
