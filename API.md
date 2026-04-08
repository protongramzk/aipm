# AIPM API Documentation

This documentation provides details on the API endpoints for the AIPM backend. The backend uses Fastify and interacts with Supabase for authentication and database management.

## Authentication

AIPM uses two types of authentication:
1.  **JWT (Supabase Auth)**: Used for user-specific operations (e.g., managing API keys, starring packages).
2.  **API Keys**: Used for programmatic access (e.g., publishing packages via CLI).

### Auth Endpoints

#### Register
`POST /auth/register`
Register a new user and automatically log them in.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "username": "myusername"
}
```

**Response:**
```json
{
  "success": true,
  "user": { ... },
  "access_token": "...",
  "refresh_token": "..."
}
```

#### Login
`POST /auth/login`
Log in an existing user.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "user": { ... },
  "access_token": "...",
  "refresh_token": "..."
}
```

#### Refresh Token
`POST /refresh-token`
Exchange a refresh token for a new access token and refresh token.

**Body:**
```json
{
  "refresh_token": "..."
}
```

**Response:**
```json
{
  "access_token": "...",
  "refresh_token": "..."
}
```

#### Get Current User Profile
`GET /auth/me`
**Header:** `Authorization: Bearer <JWT>`
Retrieve the current authenticated user's profile information.

#### Get User Profile by ID
`GET /u/:id`
Retrieve a user's profile information by their ID.

**Response:**
```json
{
  "user": {
    "id": "...",
    "username": "...",
    "created_at": "..."
  }
}
```

#### Get Current Session
`GET /auth/session`
Retrieve the current Supabase session.

---

## API Keys
Manage API keys for programmatic access. All endpoints require a valid JWT in the `Authorization` header.

#### List API Keys
`GET /api-keys`
**Header:** `Authorization: Bearer <JWT>`

#### Create API Key
`POST /api-keys`
**Header:** `Authorization: Bearer <JWT>`
**Body:**
```json
{
  "name": "Production Key"
}
```

#### Rename API Key
`PUT /api-keys/:id`
**Header:** `Authorization: Bearer <JWT>`
**Body:**
```json
{
  "name": "New Name"
}
```

#### Delete API Key
`DELETE /api-keys/:id`
**Header:** `Authorization: Bearer <JWT>`

---

## Packages

#### List Packages
`GET /packages`
List packages with optional filtering and sorting.

**Query Parameters:**
- `type`: One of `feed` (default, newest), `rank` (most stars/downloads), `trending` (hotness), `user` (filter by username), `you` (current user's packages).
- `username`: Username to filter by (required if `type=user`).

**Note:** For `type=you`, you must provide a valid JWT in the `Authorization` header.

#### Get Package Detail
`GET /mol/:pkgname`
Get detailed information about a package, including its file tree.

#### Get Package Tree
`GET /tree/:pkgname`
Get only the file tree of a package.

#### Create/Upload Package
`POST /create`
**Header:** `Authorization: Bearer <JWT>`, `x-file-name: <filename>`
Upload a package (`.tgz` file) directly as binary data.

---

## Interactions
Require a valid JWT in the `Authorization` header.

#### Toggle Star
`POST /star/:pkgname`
**Header:** `Authorization: Bearer <JWT>`
Stars or unstars a package. Includes a 3-second debounce per user per package.

#### Get Star Status
`GET /star/:pkgname`
**Header:** `Authorization: Bearer <JWT>`
Check if the current user has starred the package.
