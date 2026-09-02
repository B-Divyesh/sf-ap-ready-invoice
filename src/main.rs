use axum::{
    extract::{ConnectInfo, Path, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use dashmap::DashMap;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteLockingMode, SqlitePoolOptions},
    FromRow, SqlitePool,
};
use std::{
    net::{IpAddr, SocketAddr},
    path::{Path as FsPath, PathBuf},
    str::FromStr,
    sync::Arc,
    time::{Duration, Instant},
};
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing::{info, warn};
use uuid::Uuid;

const BUILD_SHA: &str = match option_env!("BUILD_SHA") {
    Some(value) => value,
    None => "dev",
};

#[derive(Clone)]
struct AppState {
    db: SqlitePool,
    cipher: Arc<ChaCha20Poly1305>,
    limits: Arc<DashMap<IpAddr, RateWindow>>,
    index_html: Arc<String>,
}

#[derive(Clone)]
struct RateWindow {
    start: Instant,
    count: u32,
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("Workspace not found. Start again from this browser.")]
    Unauthorized,
    #[error("That record was not found.")]
    NotFound,
    #[error("This demo has expired. Reset the demo to continue.")]
    Expired,
    #[error("Database error")]
    Db(#[from] sqlx::Error),
    #[error("Encryption error")]
    Crypto,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Expired => StatusCode::GONE,
            Self::Db(_) | Self::Crypto => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status.is_server_error() {
            warn!(error = %self, "request failed");
        }
        (status, Json(serde_json::json!({"error": self.to_string()}))).into_response()
    }
}

#[derive(Serialize)]
struct Health<'a> {
    status: &'a str,
    build_sha: &'a str,
}
#[derive(Serialize)]
struct WorkspaceReply {
    token: String,
    demo: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
struct Profile {
    freelancer_name: String,
    company_name: String,
    ap_email: String,
    billing_address: String,
    po_required: bool,
    tax_required: bool,
    bank_required: bool,
    escalation_days: i64,
}

#[derive(Debug, Serialize, Clone)]
struct Invoice {
    id: String,
    number: String,
    amount_cents: i64,
    currency: String,
    issue_date: String,
    due_date: String,
    description: String,
    po_number: String,
    tax_id: String,
    bank_details: String,
    status: String,
    status_token: String,
    created_at: String,
    checks: Vec<Check>,
    next_action: String,
}

#[derive(Debug, Serialize, Clone)]
struct Check {
    key: &'static str,
    label: &'static str,
    ready: bool,
    help: &'static str,
}
#[derive(Debug, Serialize, FromRow)]
struct Event {
    id: i64,
    invoice_id: String,
    event_type: String,
    actor: String,
    detail: String,
    created_at: String,
}
#[derive(Serialize)]
struct Dashboard {
    profile: Profile,
    invoices: Vec<Invoice>,
    events: Vec<Event>,
    demo: bool,
    expires_at: Option<String>,
}

#[derive(Deserialize)]
struct InvoiceInput {
    number: String,
    amount_cents: i64,
    currency: String,
    issue_date: String,
    due_date: String,
    description: String,
    #[serde(default)]
    po_number: String,
    #[serde(default)]
    tax_id: String,
    #[serde(default)]
    bank_details: String,
}

#[derive(Deserialize)]
struct StatusAction {
    action: String,
    #[serde(default)]
    note: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("info".parse().unwrap()),
        )
        .init();
    let data_dir = data_dir();
    tokio::fs::create_dir_all(&data_dir)
        .await
        .expect("create data directory");
    let db_path = data_dir.join("ap-ready-invoice.sqlite3");
    recover_empty_database_journal(&db_path)
        .await
        .expect("recover incomplete empty database");
    let migration_options = sqlite_connect_options(&db_path);
    let runtime_options = sqlite_connect_options(&db_path);
    let db = open_database(migration_options, runtime_options).await;
    let database_permissions = set_private_permissions(&db_path).await;
    let (key, key_source) = load_or_create_key(&data_dir.join("encryption.key"))
        .await
        .expect("load encryption key");
    info!(
        database = %db_path.display(),
        database_permissions,
        encryption_key = key_source,
        build_sha = BUILD_SHA,
        "configuration ready"
    );
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".into());
    let index = format!("{static_dir}/index.html");
    let state = AppState {
        db,
        cipher: Arc::new(ChaCha20Poly1305::new((&key).into())),
        limits: Arc::new(DashMap::new()),
        index_html: Arc::new(
            tokio::fs::read_to_string(&index)
                .await
                .expect("read frontend index"),
        ),
    };
    let api = Router::new()
        .route("/workspaces", post(create_workspace))
        .route("/demo", post(create_demo))
        .route("/dashboard", get(dashboard))
        .route("/profile", put(save_profile))
        .route("/invoices", post(create_invoice))
        .route("/invoices/{id}", put(update_invoice))
        .route("/invoices/{id}/send", post(mark_sent))
        .route("/invoices/{id}/packet", get(packet))
        .route("/invoices/{id}/audit.csv", get(audit_csv))
        .route("/security/storage-check", get(storage_check))
        .route("/status/{token}", get(public_status))
        .route("/status/{token}/action", post(public_status_action))
        .layer(middleware::from_fn_with_state(state.clone(), rate_limit));
    let app = Router::new()
        .route(
            "/health",
            get(|| async {
                Json(Health {
                    status: "ok",
                    build_sha: BUILD_SHA,
                })
            }),
        )
        .nest("/api", api)
        .route("/", get(spa_page))
        .route("/demo", get(spa_page))
        .route("/app", get(spa_page))
        .route("/pricing", get(spa_page))
        .route("/privacy", get(spa_page))
        .route("/terms", get(spa_page))
        .route("/status/{token}", get(spa_page))
        .route("/packet/{id}", get(spa_page))
        .nest_service("/assets", ServeDir::new(format!("{static_dir}/assets")))
        .route_service(
            "/favicon.svg",
            ServeFile::new(format!("{static_dir}/favicon.svg")),
        )
        .route_service(
            "/apple-touch-icon.png",
            ServeFile::new(format!("{static_dir}/apple-touch-icon.png")),
        )
        .route_service(
            "/invoice-broadsheet-720.webp",
            ServeFile::new(format!("{static_dir}/invoice-broadsheet-720.webp")),
        )
        .route_service(
            "/invoice-broadsheet-1200.webp",
            ServeFile::new(format!("{static_dir}/invoice-broadsheet-1200.webp")),
        )
        .route_service(
            "/social-card.webp",
            ServeFile::new(format!("{static_dir}/social-card.webp")),
        )
        .route_service(
            "/robots.txt",
            ServeFile::new(format!("{static_dir}/robots.txt")),
        )
        .route_service(
            "/sitemap.xml",
            ServeFile::new(format!("{static_dir}/sitemap.xml")),
        )
        .fallback(spa_not_found)
        .layer(middleware::from_fn(security_headers))
        .layer(TraceLayer::new_for_http())
        .with_state(state);
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8080);
    let address = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .expect("bind port");
    info!(%address, "server listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown())
    .await
    .expect("server error");
}

async fn security_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        "referrer-policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(
        "permissions-policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("content-security-policy", HeaderValue::from_static("default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"));
    if path.starts_with("/assets/") {
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    } else if matches!(
        path.as_str(),
        "/favicon.svg"
            | "/apple-touch-icon.png"
            | "/invoice-broadsheet-720.webp"
            | "/invoice-broadsheet-1200.webp"
            | "/social-card.webp"
    ) {
        headers.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=604800"),
        );
    } else if headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/html"))
    {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

async fn spa_page(State(state): State<AppState>) -> Html<String> {
    Html((*state.index_html).clone())
}

async fn spa_not_found(State(state): State<AppState>) -> (StatusCode, Html<String>) {
    (StatusCode::NOT_FOUND, Html((*state.index_html).clone()))
}

fn data_dir() -> PathBuf {
    if let Ok(path) = std::env::var("AP_READY_DATA_DIR") {
        return PathBuf::from(path);
    }
    let durable = FsPath::new("/data");
    if durable.exists() {
        durable.to_path_buf()
    } else {
        PathBuf::from("data")
    }
}

/// A crash during the very first `CREATE TABLE` can leave a rollback journal beside a zero-byte
/// database on Azure Files. It has no committed application pages to recover, but its server-side
/// lock can prevent the next revision from opening the database. Keep it as an evidence file and
/// let SQLite initialise a new database; never touch a non-empty database or its journal.
async fn recover_empty_database_journal(db_path: &FsPath) -> Result<bool, std::io::Error> {
    let empty_database =
        matches!(tokio::fs::metadata(db_path).await, Ok(metadata) if metadata.len() == 0);
    let journal = PathBuf::from(format!("{}-journal", db_path.display()));
    if !empty_database || tokio::fs::metadata(&journal).await.is_err() {
        return Ok(false);
    }
    let name = db_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("ap-ready-invoice.sqlite3");
    let backup = db_path.with_file_name(format!("{name}-journal.recovery-{}", Uuid::new_v4()));
    tokio::fs::rename(&journal, &backup).await?;
    warn!(database = %db_path.display(), journal = %backup.display(), "preserved stale journal from an empty database before SQLite startup");
    Ok(true)
}

async fn load_or_create_key(path: &FsPath) -> Result<([u8; 32], &'static str), std::io::Error> {
    if let Ok(bytes) = tokio::fs::read(path).await {
        if bytes.len() == 32 {
            set_private_permissions(path).await;
            let mut key = [0; 32];
            key.copy_from_slice(&bytes);
            return Ok((key, "persisted"));
        }
    }
    let mut key = [0; 32];
    OsRng.fill_bytes(&mut key);
    tokio::fs::write(path, key).await?;
    set_private_permissions(path).await;
    Ok((key, "generated"))
}

/// Azure Files mounts can reject chmod even though their mount ACLs allow reads and writes.
/// A rejected mode change must not prevent the service from starting and serving its configured
/// port; the durable share remains the source of access control in that case.
async fn set_private_permissions(path: &FsPath) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await {
            Ok(()) => return true,
            Err(error) if permissions_error_is_nonfatal(&error) => {
                warn!(path = %path.display(), error = %error, "filesystem does not support POSIX file modes; using mounted share access control");
            }
            Err(error) => {
                warn!(path = %path.display(), error = %error, "could not set private file mode; continuing with filesystem access control");
            }
        }
    }
    false
}

fn permissions_error_is_nonfatal(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::PermissionDenied
        || matches!(error.raw_os_error(), Some(1 | 95))
}

fn sqlite_connect_options(db_path: &FsPath) -> SqliteConnectOptions {
    SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.display()))
        .unwrap()
        .create_if_missing(true)
        .foreign_keys(true)
        // Azure Files is a network filesystem. DELETE journaling and a longer busy timeout avoid
        // stale lock races while a replacement revision adopts the durable database.
        // `unix-excl` avoids unreliable SMB byte-range lock upgrades. The pool's one-second idle
        // timeout below is what releases this exclusive connection between requests and revisions.
        .vfs("unix-excl")
        .journal_mode(SqliteJournalMode::Delete)
        .locking_mode(SqliteLockingMode::Exclusive)
        .busy_timeout(Duration::from_secs(60))
}

async fn open_database(
    migration_options: SqliteConnectOptions,
    runtime_options: SqliteConnectOptions,
) -> SqlitePool {
    const ATTEMPTS: u32 = 4;
    for attempt in 1..=ATTEMPTS {
        // A single exclusive connection is deliberate: this product has one SQLite writer on an
        // Azure Files share. On a failed migration, closing this pool releases its journal/lock
        // before the next attempt instead of making the process wait on its own failed connection.
        let db = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(migration_options.clone())
            .await;
        let db = match db {
            Ok(db) => db,
            Err(error)
                if startup_database_error_is_temporary(&error.to_string())
                    && attempt < ATTEMPTS =>
            {
                wait_for_database(attempt, &error).await;
                continue;
            }
            Err(error) => panic!("open database for migrations: {error}"),
        };
        match sqlx::migrate!().run(&db).await {
            Ok(()) => {
                db.close().await;
                break;
            }
            Err(error) if migration_is_locked(&error) && attempt < ATTEMPTS => {
                db.close().await;
                wait_for_database(attempt, &error).await;
            }
            Err(error) => panic!("run migrations: {error}"),
        }
    }

    for attempt in 1..=ATTEMPTS {
        match SqlitePoolOptions::new()
            .max_connections(1)
            .idle_timeout(Duration::from_secs(1))
            .connect_with(runtime_options.clone())
            .await
        {
            Ok(db) => return db,
            Err(error)
                if startup_database_error_is_temporary(&error.to_string())
                    && attempt < ATTEMPTS =>
            {
                wait_for_database(attempt, &error).await;
            }
            Err(error) => panic!("open runtime database: {error}"),
        }
    }
    unreachable!("database startup loops return or panic")
}

fn migration_is_locked(error: &sqlx::migrate::MigrateError) -> bool {
    startup_database_error_is_temporary(&error.to_string())
}

fn startup_database_error_is_temporary(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("database is locked")
        || message.contains("pool timed out")
        || message.contains("pooltimedout")
}

async fn wait_for_database(attempt: u32, error: &impl std::fmt::Display) {
    let wait = Duration::from_secs(u64::from(attempt) * 5);
    warn!(attempt, wait_seconds = wait.as_secs(), error = %error, "database is temporarily unavailable; retrying startup");
    tokio::time::sleep(wait).await;
}

async fn shutdown() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install signal handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
    info!("shutdown signal received");
}

async fn rate_limit(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let ip = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(addr.ip());
    let now = Instant::now();
    let mut entry = state.limits.entry(ip).or_insert(RateWindow {
        start: now,
        count: 0,
    });
    if now.duration_since(entry.start) >= Duration::from_secs(1) {
        entry.start = now;
        entry.count = 0;
    }
    entry.count += 1;
    if entry.count > 40 {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(header::RETRY_AFTER, "1")],
            Json(serde_json::json!({"error":"Too many requests. Wait one second and try again."})),
        )
            .into_response();
    }
    drop(entry);
    next.run(request).await
}

async fn create_workspace(State(state): State<AppState>) -> Result<Json<WorkspaceReply>, AppError> {
    let id = Uuid::new_v4().to_string();
    let token = secret_token();
    sqlx::query("INSERT INTO workspaces(id,token,is_demo) VALUES(?,?,0)")
        .bind(&id)
        .bind(&token)
        .execute(&state.db)
        .await?;
    sqlx::query("INSERT INTO profiles(workspace_id) VALUES(?)")
        .bind(&id)
        .execute(&state.db)
        .await?;
    Ok(Json(WorkspaceReply { token, demo: false }))
}

async fn create_demo(State(state): State<AppState>) -> Result<Json<WorkspaceReply>, AppError> {
    sqlx::query("DELETE FROM workspaces WHERE is_demo=1 AND expires_at < datetime('now')")
        .execute(&state.db)
        .await?;
    let id = Uuid::new_v4().to_string();
    let token = secret_token();
    sqlx::query("INSERT INTO workspaces(id,token,is_demo,expires_at) VALUES(?,?,1,datetime('now','+24 hours'))").bind(&id).bind(&token).execute(&state.db).await?;
    sqlx::query("INSERT INTO profiles(workspace_id,freelancer_name,company_name,ap_email,billing_address,po_required,tax_required,bank_required,escalation_days) VALUES(?,?,?,?,?,1,1,1,5)")
        .bind(&id).bind("Mara Vale Studio").bind("Northstar Systems Ltd").bind("ap@northstar.example").bind("85 Clerkenwell Road, London EC1M 5RF").execute(&state.db).await?;
    let input = InvoiceInput {
        number: "MVS-1042".into(),
        amount_cents: 840000,
        currency: "USD".into(),
        issue_date: "2026-08-28".into(),
        due_date: "2026-09-27".into(),
        description: "Brand system and production design — August milestone".into(),
        po_number: "PO-73918".into(),
        tax_id: "GB 123 4567 89".into(),
        bank_details: "Account ending 1842 · SWIFT MIDLGB22".into(),
    };
    insert_invoice(&state, &id, &input, "ready").await?;
    Ok(Json(WorkspaceReply { token, demo: true }))
}

async fn workspace(headers: &HeaderMap, db: &SqlitePool) -> Result<(String, bool), AppError> {
    let token = headers
        .get("x-workspace-token")
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    let row: Option<(String, bool, bool)> = sqlx::query_as(
        "SELECT id,is_demo,COALESCE(expires_at < datetime('now'),0) FROM workspaces WHERE token=?",
    )
    .bind(token)
    .fetch_optional(db)
    .await?;
    let (id, demo, expired) = row.ok_or(AppError::Unauthorized)?;
    if demo && expired {
        return Err(AppError::Expired);
    }
    Ok((id, demo))
}

async fn dashboard(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Dashboard>, AppError> {
    let (workspace_id, demo) = workspace(&headers, &state.db).await?;
    let profile: Profile = sqlx::query_as("SELECT freelancer_name,company_name,ap_email,billing_address,po_required,tax_required,bank_required,escalation_days FROM profiles WHERE workspace_id=?").bind(&workspace_id).fetch_one(&state.db).await?;
    let rows = sqlx::query_as::<_, RawInvoice>("SELECT id,number,amount_cents,currency,issue_date,due_date,description,po_number,tax_id_enc,bank_details_enc,status,status_token,created_at FROM invoices WHERE workspace_id=? ORDER BY created_at DESC").bind(&workspace_id).fetch_all(&state.db).await?;
    let invoices: Vec<Invoice> = rows
        .into_iter()
        .map(|r| inflate(&state, r, &profile))
        .collect::<Result<_, _>>()?;
    let events = sqlx::query_as("SELECT events.id,events.invoice_id,events.event_type,events.actor,events.detail,events.created_at FROM events JOIN invoices ON invoices.id=events.invoice_id WHERE invoices.workspace_id=? ORDER BY events.id DESC")
        .bind(&workspace_id).fetch_all(&state.db).await?;
    let expires_at: Option<String> =
        sqlx::query_scalar("SELECT expires_at FROM workspaces WHERE id=?")
            .bind(&workspace_id)
            .fetch_one(&state.db)
            .await?;
    Ok(Json(Dashboard {
        profile,
        invoices,
        events,
        demo,
        expires_at,
    }))
}

async fn save_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(p): Json<Profile>,
) -> Result<Json<Profile>, AppError> {
    let (workspace_id, _) = workspace(&headers, &state.db).await?;
    if !p.ap_email.contains('@') {
        return Err(AppError::BadRequest(
            "Enter the finance team's email address.".into(),
        ));
    }
    if !(1..=30).contains(&p.escalation_days) {
        return Err(AppError::BadRequest(
            "Set follow-up between 1 and 30 days.".into(),
        ));
    }
    sqlx::query("UPDATE profiles SET freelancer_name=?,company_name=?,ap_email=?,billing_address=?,po_required=?,tax_required=?,bank_required=?,escalation_days=?,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=?")
        .bind(&p.freelancer_name).bind(&p.company_name).bind(&p.ap_email).bind(&p.billing_address).bind(p.po_required).bind(p.tax_required).bind(p.bank_required).bind(p.escalation_days).bind(workspace_id).execute(&state.db).await?;
    Ok(Json(p))
}

async fn create_invoice(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<InvoiceInput>,
) -> Result<(StatusCode, Json<Invoice>), AppError> {
    let (workspace_id, _) = workspace(&headers, &state.db).await?;
    validate_invoice(&input)?;
    let raw = insert_invoice(&state, &workspace_id, &input, "draft").await?;
    let profile: Profile = sqlx::query_as("SELECT freelancer_name,company_name,ap_email,billing_address,po_required,tax_required,bank_required,escalation_days FROM profiles WHERE workspace_id=?").bind(workspace_id).fetch_one(&state.db).await?;
    Ok((StatusCode::CREATED, Json(inflate(&state, raw, &profile)?)))
}

async fn update_invoice(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<InvoiceInput>,
) -> Result<Json<Invoice>, AppError> {
    let (workspace_id, _) = workspace(&headers, &state.db).await?;
    validate_invoice(&input)?;
    let profile: Profile = sqlx::query_as("SELECT freelancer_name,company_name,ap_email,billing_address,po_required,tax_required,bank_required,escalation_days FROM profiles WHERE workspace_id=?").bind(&workspace_id).fetch_one(&state.db).await?;
    let checks = make_checks(&profile, &input);
    let status = if checks.iter().all(|c| c.ready) {
        "ready"
    } else {
        "draft"
    };
    let result = sqlx::query("UPDATE invoices SET number=?,amount_cents=?,currency=?,issue_date=?,due_date=?,description=?,po_number=?,tax_id_enc=?,bank_details_enc=?,status=? WHERE id=? AND workspace_id=?")
        .bind(&input.number).bind(input.amount_cents).bind(&input.currency).bind(&input.issue_date).bind(&input.due_date).bind(&input.description).bind(&input.po_number).bind(encrypt(&state, &input.tax_id)?).bind(encrypt(&state, &input.bank_details)?).bind(status).bind(&id).bind(&workspace_id).execute(&state.db).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    sqlx::query(
        "INSERT INTO events(invoice_id,event_type,actor,detail) VALUES(?,'checked','You',?)",
    )
    .bind(&id)
    .bind(if status == "ready" {
        "Preflight passed"
    } else {
        "Preflight needs changes"
    })
    .execute(&state.db)
    .await?;
    let raw = fetch_raw(&state.db, &id, Some(&workspace_id)).await?;
    Ok(Json(inflate(&state, raw, &profile)?))
}

async fn mark_sent(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let (workspace_id, _) = workspace(&headers, &state.db).await?;
    let result = sqlx::query("UPDATE invoices SET status='waiting_on_ap' WHERE id=? AND workspace_id=? AND status IN ('ready','waiting_on_ap')").bind(&id).bind(&workspace_id).execute(&state.db).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::BadRequest(
            "This packet is not ready. Fix every preflight item before marking it sent.".into(),
        ));
    }
    let escalation_days: i64 =
        sqlx::query_scalar("SELECT escalation_days FROM profiles WHERE workspace_id=?")
            .bind(&workspace_id)
            .fetch_one(&state.db)
            .await?;
    sqlx::query("INSERT INTO events(invoice_id,event_type,actor,detail) VALUES(?,'sent','You','Invoice packet marked as sent to accounts payable')").bind(&id).execute(&state.db).await?;
    sqlx::query("INSERT INTO events(invoice_id,event_type,actor,detail) VALUES(?,'follow_up_due','AP-Ready Invoice',?)")
        .bind(&id)
        .bind(format!("Follow up in {escalation_days} days if accounts payable has not replied"))
        .execute(&state.db)
        .await?;
    Ok(Json(
        serde_json::json!({"status":"waiting_on_ap","next_action":"Accounts payable confirms receipt"}),
    ))
}

async fn packet(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let (workspace_id, _) = workspace(&headers, &state.db).await?;
    let profile: Profile = sqlx::query_as("SELECT freelancer_name,company_name,ap_email,billing_address,po_required,tax_required,bank_required,escalation_days FROM profiles WHERE workspace_id=?").bind(&workspace_id).fetch_one(&state.db).await?;
    let raw = fetch_raw(&state.db, &id, Some(&workspace_id)).await?;
    let invoice = inflate(&state, raw, &profile)?;
    let base = "https://ap-ready-invoice.sociobot.in";
    Ok(Json(serde_json::json!({
        "invoice": invoice,
        "profile": profile,
        "email": {"to": profile.ap_email, "subject": format!("Invoice {} · {}", invoice.number, profile.freelancer_name), "body": format!("Hello,\n\nPlease find invoice {} for {}. The due date is {}.\n\nYou can confirm receipt or request a change here:\n{}/status/{}\n\nThank you,\n{}", invoice.number, money(invoice.amount_cents, &invoice.currency), invoice.due_date, base, invoice.status_token, profile.freelancer_name)},
        "status_url": format!("{}/status/{}", base, invoice.status_token)
    })))
}

async fn audit_csv(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let (workspace_id, _) = workspace(&headers, &state.db).await?;
    let _ = fetch_raw(&state.db, &id, Some(&workspace_id)).await?;
    let events: Vec<Event> = sqlx::query_as(
        "SELECT id,invoice_id,event_type,actor,detail,created_at FROM events WHERE invoice_id=? ORDER BY id",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    let mut csv = String::from("timestamp,event,actor,detail\n");
    for e in events {
        csv.push_str(&format!(
            "{},{},{},{}\n",
            csv_cell(&e.created_at),
            csv_cell(&e.event_type),
            csv_cell(&e.actor),
            csv_cell(&e.detail)
        ));
    }
    let mut response = csv.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/csv; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=invoice-audit.csv"),
    );
    Ok(response)
}

async fn storage_check(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let (workspace_id, _) = workspace(&headers, &state.db).await?;
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT tax_id_enc,bank_details_enc FROM invoices WHERE workspace_id=?")
            .bind(workspace_id)
            .fetch_all(&state.db)
            .await?;
    let encrypted = rows.iter().all(|(tax, bank)| {
        let tax_plain = decrypt(&state, tax).unwrap_or_default();
        let bank_plain = decrypt(&state, bank).unwrap_or_default();
        (tax_plain.is_empty() || (!tax.contains(&tax_plain) && tax.len() > tax_plain.len()))
            && (bank_plain.is_empty()
                || (!bank.contains(&bank_plain) && bank.len() > bank_plain.len()))
    });
    Ok(Json(
        serde_json::json!({"encrypted": encrypted, "records": rows.len()}),
    ))
}

async fn public_status(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let raw = fetch_raw_by_token(&state.db, &token).await?;
    let profile: Profile = sqlx::query_as("SELECT freelancer_name,company_name,ap_email,billing_address,po_required,tax_required,bank_required,escalation_days FROM profiles WHERE workspace_id=(SELECT workspace_id FROM invoices WHERE status_token=?)").bind(&token).fetch_one(&state.db).await?;
    let invoice = inflate(&state, raw, &profile)?;
    sqlx::query("INSERT INTO events(invoice_id,event_type,actor,detail) VALUES(?,'viewed','Accounts payable','Status page opened')").bind(&invoice.id).execute(&state.db).await?;
    Ok(Json(
        serde_json::json!({"number":invoice.number,"amount":money(invoice.amount_cents,&invoice.currency),"due_date":invoice.due_date,"status":invoice.status,"sender":profile.freelancer_name,"company":profile.company_name}),
    ))
}

async fn public_status_action(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(input): Json<StatusAction>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (status, label) = match input.action.as_str() {
        "received" => ("received", "Receipt confirmed"),
        "needs_changes" => ("needs_changes", "Change requested"),
        "approved" => ("approved", "Invoice approved"),
        _ => {
            return Err(AppError::BadRequest(
                "Choose received, needs changes, or approved.".into(),
            ))
        }
    };
    if input.note.chars().count() > 500 {
        return Err(AppError::BadRequest(
            "Keep the note under 500 characters.".into(),
        ));
    }
    let id: Option<String> = sqlx::query_scalar("SELECT id FROM invoices WHERE status_token=?")
        .bind(&token)
        .fetch_optional(&state.db)
        .await?;
    let id = id.ok_or(AppError::NotFound)?;
    sqlx::query("UPDATE invoices SET status=? WHERE id=?")
        .bind(status)
        .bind(&id)
        .execute(&state.db)
        .await?;
    let detail = if input.note.trim().is_empty() {
        label.into()
    } else {
        format!("{}: {}", label, input.note.trim())
    };
    sqlx::query(
        "INSERT INTO events(invoice_id,event_type,actor,detail) VALUES(?,?, 'Accounts payable',?)",
    )
    .bind(&id)
    .bind(status)
    .bind(&detail)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({"status":status,"message":label})))
}

#[derive(FromRow)]
struct RawInvoice {
    id: String,
    number: String,
    amount_cents: i64,
    currency: String,
    issue_date: String,
    due_date: String,
    description: String,
    po_number: String,
    tax_id_enc: String,
    bank_details_enc: String,
    status: String,
    status_token: String,
    created_at: String,
}

async fn insert_invoice(
    state: &AppState,
    workspace_id: &str,
    input: &InvoiceInput,
    initial_status: &str,
) -> Result<RawInvoice, AppError> {
    validate_invoice(input)?;
    let id = Uuid::new_v4().to_string();
    let status_token = secret_token();
    sqlx::query("INSERT INTO invoices(id,workspace_id,number,amount_cents,currency,issue_date,due_date,description,po_number,tax_id_enc,bank_details_enc,status,status_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&id).bind(workspace_id).bind(&input.number).bind(input.amount_cents).bind(&input.currency).bind(&input.issue_date).bind(&input.due_date).bind(&input.description).bind(&input.po_number).bind(encrypt(state,&input.tax_id)?).bind(encrypt(state,&input.bank_details)?).bind(initial_status).bind(&status_token).execute(&state.db).await.map_err(|e| if e.to_string().contains("UNIQUE") { AppError::BadRequest("That invoice number already exists. Use a different number.".into()) } else { AppError::Db(e) })?;
    sqlx::query("INSERT INTO events(invoice_id,event_type,actor,detail) VALUES(?,'created','You','Invoice added')").bind(&id).execute(&state.db).await?;
    fetch_raw(&state.db, &id, Some(workspace_id)).await
}

async fn fetch_raw(
    db: &SqlitePool,
    id: &str,
    workspace: Option<&str>,
) -> Result<RawInvoice, AppError> {
    let row = if let Some(w) = workspace {
        sqlx::query_as("SELECT id,number,amount_cents,currency,issue_date,due_date,description,po_number,tax_id_enc,bank_details_enc,status,status_token,created_at FROM invoices WHERE id=? AND workspace_id=?").bind(id).bind(w).fetch_optional(db).await?
    } else {
        sqlx::query_as("SELECT id,number,amount_cents,currency,issue_date,due_date,description,po_number,tax_id_enc,bank_details_enc,status,status_token,created_at FROM invoices WHERE id=?").bind(id).fetch_optional(db).await?
    };
    row.ok_or(AppError::NotFound)
}
async fn fetch_raw_by_token(db: &SqlitePool, token: &str) -> Result<RawInvoice, AppError> {
    sqlx::query_as("SELECT id,number,amount_cents,currency,issue_date,due_date,description,po_number,tax_id_enc,bank_details_enc,status,status_token,created_at FROM invoices WHERE status_token=?").bind(token).fetch_optional(db).await?.ok_or(AppError::NotFound)
}

fn inflate(state: &AppState, r: RawInvoice, p: &Profile) -> Result<Invoice, AppError> {
    let input = InvoiceInput {
        number: r.number.clone(),
        amount_cents: r.amount_cents,
        currency: r.currency.clone(),
        issue_date: r.issue_date.clone(),
        due_date: r.due_date.clone(),
        description: r.description.clone(),
        po_number: r.po_number.clone(),
        tax_id: decrypt(state, &r.tax_id_enc)?,
        bank_details: decrypt(state, &r.bank_details_enc)?,
    };
    let checks = make_checks(p, &input);
    let next_action = match r.status.as_str() {
        "draft" => "You fix the missing invoice details",
        "ready" => "You send the invoice packet",
        "waiting_on_ap" => "Accounts payable confirms receipt",
        "received" => "Accounts payable reviews the invoice",
        "needs_changes" => "You update the requested details",
        "approved" => "Accounts payable schedules payment",
        _ => "You review the invoice",
    }
    .into();
    Ok(Invoice {
        id: r.id,
        number: r.number,
        amount_cents: r.amount_cents,
        currency: r.currency,
        issue_date: r.issue_date,
        due_date: r.due_date,
        description: r.description,
        po_number: r.po_number,
        tax_id: input.tax_id,
        bank_details: input.bank_details,
        status: r.status,
        status_token: r.status_token,
        created_at: r.created_at,
        checks,
        next_action,
    })
}

fn make_checks(p: &Profile, i: &InvoiceInput) -> Vec<Check> {
    let dates_ready = match (
        parse_calendar_date(&i.issue_date),
        parse_calendar_date(&i.due_date),
    ) {
        (Some(issue), Some(due)) => due >= issue,
        _ => false,
    };
    vec![
        Check {
            key: "identity",
            label: "Invoice number and sender",
            ready: !i.number.trim().is_empty() && !p.freelancer_name.trim().is_empty(),
            help: "Add an invoice number and your sender name.",
        },
        Check {
            key: "payer",
            label: "AP recipient and billing address",
            ready: p.ap_email.contains('@') && !p.billing_address.trim().is_empty(),
            help: "Add the finance email and billing address.",
        },
        Check {
            key: "dates",
            label: "Issue and due dates",
            ready: dates_ready,
            help: "Use real calendar dates, with the due date on or after the issue date.",
        },
        Check {
            key: "po",
            label: "Purchase order",
            ready: !p.po_required || !i.po_number.trim().is_empty(),
            help: "This client requires a PO number.",
        },
        Check {
            key: "tax",
            label: "Tax identifier",
            ready: !p.tax_required || !i.tax_id.trim().is_empty(),
            help: "This client requires a tax identifier.",
        },
        Check {
            key: "bank",
            label: "Payment details",
            ready: !p.bank_required || !i.bank_details.trim().is_empty(),
            help: "Add the payment instructions AP needs.",
        },
        Check {
            key: "amount",
            label: "Amount and work description",
            ready: i.amount_cents > 0 && !i.description.trim().is_empty(),
            help: "Add a positive amount and work description.",
        },
    ]
}

fn validate_invoice(i: &InvoiceInput) -> Result<(), AppError> {
    if i.number.trim().is_empty() || i.number.len() > 50 {
        return Err(AppError::BadRequest(
            "Enter an invoice number under 50 characters.".into(),
        ));
    }
    if i.amount_cents <= 0 || i.amount_cents > 1_000_000_000 {
        return Err(AppError::BadRequest(
            "Enter an amount greater than zero.".into(),
        ));
    }
    if !["USD", "GBP", "EUR", "CAD", "AUD", "INR"].contains(&i.currency.as_str()) {
        return Err(AppError::BadRequest("Choose a supported currency.".into()));
    }
    let issue_date = parse_calendar_date(&i.issue_date).ok_or_else(|| {
        AppError::BadRequest("Enter a real issue date in YYYY-MM-DD format.".into())
    })?;
    let due_date = parse_calendar_date(&i.due_date).ok_or_else(|| {
        AppError::BadRequest("Enter a real due date in YYYY-MM-DD format.".into())
    })?;
    if due_date < issue_date {
        return Err(AppError::BadRequest(
            "The due date must be on or after the issue date.".into(),
        ));
    }
    if i.description.trim().is_empty() || i.description.len() > 500 {
        return Err(AppError::BadRequest(
            "Describe the work in 500 characters or fewer.".into(),
        ));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct CalendarDate {
    year: u16,
    month: u8,
    day: u8,
}

fn parse_calendar_date(value: &str) -> Option<CalendarDate> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
    {
        return None;
    }
    let year = value[0..4].parse::<u16>().ok()?;
    let month = value[5..7].parse::<u8>().ok()?;
    let day = value[8..10].parse::<u8>().ok()?;
    if year == 0 || !(1..=12).contains(&month) {
        return None;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    (day >= 1 && day <= days).then_some(CalendarDate { year, month, day })
}
fn secret_token() -> String {
    let mut b = [0u8; 32];
    OsRng.fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}
fn encrypt(state: &AppState, text: &str) -> Result<String, AppError> {
    if text.is_empty() {
        return Ok(String::new());
    }
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = state
        .cipher
        .encrypt(Nonce::from_slice(&nonce), text.as_bytes())
        .map_err(|_| AppError::Crypto)?;
    let mut out = nonce.to_vec();
    out.extend(encrypted);
    Ok(URL_SAFE_NO_PAD.encode(out))
}
fn decrypt(state: &AppState, text: &str) -> Result<String, AppError> {
    if text.is_empty() {
        return Ok(String::new());
    }
    let data = URL_SAFE_NO_PAD.decode(text).map_err(|_| AppError::Crypto)?;
    if data.len() < 13 {
        return Err(AppError::Crypto);
    }
    let plain = state
        .cipher
        .decrypt(Nonce::from_slice(&data[..12]), &data[12..])
        .map_err(|_| AppError::Crypto)?;
    String::from_utf8(plain).map_err(|_| AppError::Crypto)
}
fn csv_cell(v: &str) -> String {
    format!("\"{}\"", v.replace('"', "\"\""))
}
fn money(cents: i64, currency: &str) -> String {
    format!("{} {:.2}", currency, cents as f64 / 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checks_required_po() {
        let p = Profile {
            freelancer_name: "A".into(),
            company_name: "B".into(),
            ap_email: "a@b.com".into(),
            billing_address: "x".into(),
            po_required: true,
            tax_required: false,
            bank_required: false,
            escalation_days: 5,
        };
        let i = InvoiceInput {
            number: "1".into(),
            amount_cents: 100,
            currency: "USD".into(),
            issue_date: "2026-01-01".into(),
            due_date: "2026-02-01".into(),
            description: "Work".into(),
            po_number: "".into(),
            tax_id: "".into(),
            bank_details: "".into(),
        };
        assert!(
            !make_checks(&p, &i)
                .iter()
                .find(|c| c.key == "po")
                .unwrap()
                .ready
        )
    }
    #[test]
    fn validates_dates() {
        let mut i = InvoiceInput {
            number: "1".into(),
            amount_cents: 100,
            currency: "USD".into(),
            issue_date: "2026-02-01".into(),
            due_date: "2026-01-01".into(),
            description: "Work".into(),
            po_number: "".into(),
            tax_id: "".into(),
            bank_details: "".into(),
        };
        assert!(validate_invoice(&i).is_err());

        i.issue_date = "not-a-date".into();
        i.due_date = "zzzz".into();
        assert!(
            matches!(validate_invoice(&i), Err(AppError::BadRequest(message)) if message.contains("issue date"))
        );

        i.issue_date = "2026-02-30".into();
        i.due_date = "2026-03-01".into();
        assert!(validate_invoice(&i).is_err());

        i.issue_date = "2024-02-29".into();
        i.due_date = "2024-02-29".into();
        assert!(validate_invoice(&i).is_ok());
    }

    #[test]
    fn preflight_never_marks_malformed_dates_ready() {
        let p = Profile {
            freelancer_name: "A".into(),
            company_name: "B".into(),
            ap_email: "a@b.com".into(),
            billing_address: "x".into(),
            po_required: false,
            tax_required: false,
            bank_required: false,
            escalation_days: 5,
        };
        let i = InvoiceInput {
            number: "1".into(),
            amount_cents: 100,
            currency: "USD".into(),
            issue_date: "not-a-date".into(),
            due_date: "zzzz".into(),
            description: "Work".into(),
            po_number: "".into(),
            tax_id: "".into(),
            bank_details: "".into(),
        };
        assert!(
            !make_checks(&p, &i)
                .iter()
                .find(|check| check.key == "dates")
                .unwrap()
                .ready
        );
    }

    #[test]
    fn allows_azure_files_style_mode_errors_without_blocking_startup() {
        let access_denied = std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "operation not permitted on mounted share",
        );
        let unsupported = std::io::Error::from_raw_os_error(95); // EOPNOTSUPP on Linux
        assert!(permissions_error_is_nonfatal(&access_denied));
        assert!(permissions_error_is_nonfatal(&unsupported));
        assert!(!permissions_error_is_nonfatal(
            &std::io::Error::from_raw_os_error(5)
        ));
    }

    #[test]
    fn retries_only_a_temporary_sqlite_lock_during_startup() {
        let locked = sqlx::migrate::MigrateError::Execute(sqlx::Error::Protocol(
            "database is locked".into(),
        ));
        let invalid = sqlx::migrate::MigrateError::Execute(sqlx::Error::Protocol(
            "database disk image is malformed".into(),
        ));
        assert!(migration_is_locked(&locked));
        assert!(!migration_is_locked(&invalid));
        assert!(startup_database_error_is_temporary("PoolTimedOut"));
        assert!(!startup_database_error_is_temporary(
            "database disk image is malformed"
        ));
    }

    #[tokio::test]
    async fn idle_runtime_pool_releases_exclusive_lock_for_next_revision() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("rolling.sqlite3");
        let migration = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(sqlite_connect_options(&database))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE deployment_probe(id INTEGER PRIMARY KEY)")
            .execute(&migration)
            .await
            .unwrap();
        migration.close().await;

        let first_revision = SqlitePoolOptions::new()
            .max_connections(1)
            .idle_timeout(Duration::from_millis(50))
            .connect_with(sqlite_connect_options(&database))
            .await
            .unwrap();
        let locking_mode: String = sqlx::query_scalar("PRAGMA locking_mode")
            .fetch_one(&first_revision)
            .await
            .unwrap();
        assert_eq!(locking_mode, "exclusive");
        for _ in 0..20 {
            if first_revision.size() == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(first_revision.size(), 0);

        let next_revision = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(sqlite_connect_options(&database))
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM deployment_probe")
            .fetch_one(&next_revision)
            .await
            .unwrap();
        assert_eq!(count, 0);
        first_revision.close().await;
        next_revision.close().await;
    }

    #[tokio::test]
    async fn preserves_a_stale_journal_beside_an_empty_database() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("invoice.sqlite3");
        let journal = PathBuf::from(format!("{}-journal", database.display()));
        tokio::fs::write(&database, []).await.unwrap();
        tokio::fs::write(&journal, b"incomplete first migration")
            .await
            .unwrap();

        assert!(recover_empty_database_journal(&database).await.unwrap());
        assert!(!journal.exists());
        let preserved = std::fs::read_dir(directory.path())
            .unwrap()
            .filter_map(Result::ok)
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains("journal.recovery-")
            })
            .unwrap();
        assert_eq!(
            std::fs::read(preserved.path()).unwrap(),
            b"incomplete first migration"
        );
    }
}
