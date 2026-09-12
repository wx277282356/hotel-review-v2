using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using System.Globalization;
using System.Threading.RateLimiting;
using HotelReview.Api.Data;
using HotelReview.Api.Models;
using HotelReview.Api.Auth;

var builder = WebApplication.CreateBuilder(args);

// 真实密钥（数据库密码、管理员令牌）放 appsettings.Local.json，该文件已被 .gitignore 排除。
// 本文件 appsettings.json 只保留模板占位符，可安全提交到公开仓库。
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: false);

// 启动前置校验：连接串没配好就明确报错，而不是跑起来后连不上库
var connStr = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connStr) || connStr.Contains("CHANGE_ME"))
{
    Console.WriteLine("======================================================");
    Console.WriteLine(" ✗ 数据库连接串未配置！");
    Console.WriteLine("   请把 backend/appsettings.json 复制一份为");
    Console.WriteLine("   backend/appsettings.Local.json，并在其中填入真实密码。");
    Console.WriteLine("   （appsettings.Local.json 不会提交到 Git）");
    Console.WriteLine("======================================================");
    return;
}

// 后端监听端口（前端 vite 代理指向这里）。
// 端口默认 5188 —— cloudflared 隧道与「一键启动」都按这个端口对接，不要随手改。
// 但允许用环境变量临时顶掉：要在本机同时跑一份新版做对照验证、又不想停掉正在服务的那份时，
// 设 ASPNETCORE_URLS=http://localhost:5189 即可（正常启动不需要设）。
var listenUrls = Environment.GetEnvironmentVariable("ASPNETCORE_URLS");
builder.WebHost.UseUrls(string.IsNullOrWhiteSpace(listenUrls)
    ? "http://localhost:5188"
    : listenUrls);

// PostgreSQL 连接
builder.Services.AddDbContext<AppDbContext>(opt => opt.UseNpgsql(connStr));

builder.Services.AddCors();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// ============================== 防刷限流 ==============================
// POST /api/review 是**公开且免登录**的，还经隧道暴露在公网 —— 没有任何限制的话，
// 随便一个脚本就能灌进成千上万条垃圾评价。这里按客户端 IP 做「令牌桶」限流：
// 允许短时突发（客人一波退房同时评价），但持续速率受限。
// 参数可在 appsettings 的 ReviewRateLimit 下调整，不用改代码。
var rlBurst = builder.Configuration.GetValue<int?>("ReviewRateLimit:Burst") ?? 30;
var rlPerMinute = builder.Configuration.GetValue<int?>("ReviewRateLimit:TokensPerMinute") ?? 12;

// 取真实客户端 IP。
// ⚠️ 关键：经 Cloudflare 隧道时，直连后端的是本机 cloudflared，
// 只看 RemoteIpAddress 会全是 127.0.0.1 —— 限流就从"按客人"退化成"全酒店共用一份额度"，
// 高峰期会误伤真实客人。所以必须靠转发头还原真实 IP。
// Cloudflare 会把真实 IP 写进 CF-Connecting-IP 且会覆盖伪造值，优先用它。
static string ClientKey(HttpContext ctx)
{
    var cf = ctx.Request.Headers["CF-Connecting-IP"].ToString();
    if (!string.IsNullOrWhiteSpace(cf)) return "cf:" + cf.Trim();
    return "ip:" + (ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown");
}

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("review", ctx => RateLimitPartition.GetTokenBucketLimiter(
        ClientKey(ctx),
        _ => new TokenBucketRateLimiterOptions
        {
            TokenLimit = rlBurst,                                   // 突发上限
            TokensPerPeriod = rlPerMinute,                          // 每分钟回补量
            ReplenishmentPeriod = TimeSpan.FromMinutes(1),
            AutoReplenishment = true,
            QueueLimit = 0                                          // 不排队，直接拒绝
        }));

    // 登录接口单独用更严的额度，防密码暴力猜解
    o.AddPolicy("login", ctx => RateLimitPartition.GetTokenBucketLimiter(
        ClientKey(ctx),
        _ => new TokenBucketRateLimiterOptions
        {
            TokenLimit = 10,
            TokensPerPeriod = 5,
            ReplenishmentPeriod = TimeSpan.FromMinutes(1),
            AutoReplenishment = true,
            QueueLimit = 0
        }));

    // 被限流时回一句人能看懂的话。
    // 注意必须自己写 JSON 且带上 CORS 头，否则浏览器只会报"跨域错误"，
    // 客人看到的是一句莫名其妙的网络错误，而不是"提交太频繁"。
    o.OnRejected = async (ctx, ct) =>
    {
        var res = ctx.HttpContext.Response;
        res.StatusCode = StatusCodes.Status429TooManyRequests;
        res.ContentType = "application/json; charset=utf-8";
        if (ctx.HttpContext.Request.Headers.ContainsKey("Origin"))
        {
            res.Headers.AccessControlAllowOrigin = "*";
            res.Headers.AccessControlAllowHeaders = "*";
            res.Headers.AccessControlAllowMethods = "*";
        }
        await res.WriteAsync("""{"error":"提交太频繁了，请稍等一会儿再试"}""", ct);
    };
});

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

// 还原代理转发的真实客户端 IP / 协议（隧道场景必需）。
// 不用额外配 KnownProxies：默认只信任 loopback，而 cloudflared 正是从本机连进来的。
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 2
});

// WithExposedHeaders 不能省：浏览器默认**不把**自定义响应头交给前端 JS，
// 分页总数就是靠 X-Total-Count 带回来的，不暴露的话前端永远读不到。
app.UseCors(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()
                  .WithExposedHeaders("X-Total-Count"));

// 顺序要紧：CORS 必须在限流之前，这样 429 响应才带得上跨域头
app.UseRateLimiter();

// 建表 + 引导管理员
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();

    // 全新库由 EF 建表
    db.Database.EnsureCreated();

    // 注意：EnsureCreated 对"已存在的库"不会补建新表，故这里用幂等 DDL 兜底
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "Staffs" (
            "Id" uuid PRIMARY KEY,
            "Username" text NOT NULL,
            "PasswordHash" text NOT NULL,
            "DisplayName" text NOT NULL DEFAULT '',
            "Role" text NOT NULL DEFAULT 'viewer',
            "IsActive" boolean NOT NULL DEFAULT true,
            "CreatedAt" timestamptz NOT NULL DEFAULT now()
        );
        """);
    db.Database.ExecuteSqlRaw("""
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_Staffs_Username" ON "Staffs" ("Username");
        """);
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "Sessions" (
            "Token" text PRIMARY KEY,
            "StaffId" uuid NOT NULL,
            "CreatedAt" timestamptz NOT NULL DEFAULT now(),
            "ExpiresAt" timestamptz NOT NULL
        );
        """);
    // 单行配置表：酒店名称/文案/好评差评原因列表（Data 是 SiteSettings 的 JSON）
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "AppSettings" (
            "Id" integer PRIMARY KEY,
            "Data" text NOT NULL,
            "UpdatedAt" timestamptz NOT NULL DEFAULT now()
        );
        """);

    // 给已存在的库补列（EnsureCreated 只管建新表，不会给老表加字段）。
    // 员工姓名：旧系统登在已登录设备上提交时会记下姓名，明细与按工号统计要用。
    db.Database.ExecuteSqlRaw("""
        ALTER TABLE "Reviews" ADD COLUMN IF NOT EXISTS "StaffName" text;
        """);

    // 首次运行：用主令牌（AdminToken）作为初始密码，建一个超级管理员账号
    if (!db.Staffs.Any())
    {
        // 不硬编码任何默认密码：未配置 AdminToken 时随机生成并在控制台打印，
        // 避免"提交到公开仓库的默认口令"变成后门。
        var initialPwd = config["AdminToken"];
        var generated = false;
        if (string.IsNullOrWhiteSpace(initialPwd) || initialPwd.Contains("CHANGE_ME"))
        {
            initialPwd = AuthUtil.NewToken();
            generated = true;
        }
        db.Staffs.Add(new Staff
        {
            Id = Guid.NewGuid(),
            Username = "admin",
            PasswordHash = AuthUtil.HashPassword(initialPwd!),
            DisplayName = "超级管理员",
            Role = "admin",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        });
        db.SaveChanges();
        Console.WriteLine("======================================================");
        Console.WriteLine(" 已创建初始管理员账号：用户名 admin");
        if (generated)
        {
            Console.WriteLine(" ⚠ 未配置 AdminToken，已随机生成本次初始密码（仅显示这一次）：");
            Console.WriteLine($"   {initialPwd}");
        }
        else
        {
            Console.WriteLine(" 初始密码 = appsettings.Local.json 里的 AdminToken");
        }
        Console.WriteLine(" 请登录后立即在「账号管理」里修改密码！");
        Console.WriteLine("======================================================");
    }
}

// ============================== 认证 ==============================

// 登录：用户名 + 密码 → 会话令牌（有效期 30 天）
app.MapPost("/api/auth/login", async (LoginReq req, AppDbContext db) =>
{
    var username = (req.Username ?? "").Trim();
    if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(req.Password))
        return Results.BadRequest(new { error = "用户名和密码不能为空" });

    var staff = await db.Staffs.FirstOrDefaultAsync(s => s.Username == username);
    // 用户不存在 / 已停用 / 密码错 —— 统一返回同一句提示，避免暴露账号是否存在
    if (staff == null || !staff.IsActive || !AuthUtil.VerifyPassword(req.Password, staff.PasswordHash))
        return Results.Json(new { error = "用户名或密码错误" }, statusCode: 401);

    var session = new Session
    {
        Token = AuthUtil.NewToken(),
        StaffId = staff.Id,
        CreatedAt = DateTime.UtcNow,
        ExpiresAt = DateTime.UtcNow.AddDays(30)
    };
    db.Sessions.Add(session);
    await db.SaveChangesAsync();

    return Results.Ok(new
    {
        token = session.Token,
        role = staff.Role,
        username = staff.Username,
        displayName = staff.DisplayName,
        expiresAt = session.ExpiresAt
    });
}).RequireRateLimiting("login");

// 当前身份（前端启动时校验登录是否还有效）
app.MapGet("/api/auth/me", async (string? token, AppDbContext db, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    return Results.Ok(new { role = me.Role, username = me.Username, displayName = me.DisplayName });
});

// 退出登录（销毁当前会话；主令牌无会话可销毁，直接返回成功）
app.MapPost("/api/auth/logout", async (string? token, AppDbContext db, IConfiguration cfg) =>
{
    if (!string.IsNullOrWhiteSpace(token))
    {
        var sessions = await db.Sessions.Where(s => s.Token == token).ToListAsync();
        if (sessions.Count > 0)
        {
            db.Sessions.RemoveRange(sessions);
            await db.SaveChangesAsync();
        }
    }
    return Results.Ok(new { ok = true });
});

// 自助修改密码
app.MapPost("/api/auth/password", async (PasswordReq req, string? token, AppDbContext db, IConfiguration cfg) =>
{
    if (string.IsNullOrWhiteSpace(req.NewPassword) || req.NewPassword.Length < 6)
        return Results.BadRequest(new { error = "新密码至少 6 位" });

    var session = await db.Sessions.FirstOrDefaultAsync(s => s.Token == token);
    if (session == null)
        return Results.BadRequest(new { error = "主令牌无法改密，请用账号登录后再改" });

    var staff = await db.Staffs.FirstOrDefaultAsync(s => s.Id == session.StaffId);
    if (staff == null || !staff.IsActive) return Results.Unauthorized();
    if (!AuthUtil.VerifyPassword(req.OldPassword ?? "", staff.PasswordHash))
        return Results.BadRequest(new { error = "原密码不正确" });

    staff.PasswordHash = AuthUtil.HashPassword(req.NewPassword);
    await db.SaveChangesAsync();
    // 让本人的其它会话失效，但保留当前这次
    await AuthUtil.ClearSessionsAsync(staff.Id, db, keepToken: session.Token);
    return Results.Ok(new { ok = true });
});

// ============================== 账号管理（仅管理员）==============================

app.MapGet("/api/staff", async (string? token, AppDbContext db, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    if (!me.IsAdmin) return Results.Json(new { error = "需要管理员权限" }, statusCode: 403);

    var list = await db.Staffs.OrderBy(s => s.CreatedAt).ToListAsync();
    return Results.Ok(list.Select(s => new
    {
        s.Id,
        s.Username,
        s.DisplayName,
        s.Role,
        s.IsActive,
        s.CreatedAt
    }));
});

app.MapPost("/api/staff", async (StaffCreateReq req, string? token, AppDbContext db, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    if (!me.IsAdmin) return Results.Json(new { error = "需要管理员权限" }, statusCode: 403);

    var username = (req.Username ?? "").Trim();
    if (string.IsNullOrWhiteSpace(username)) return Results.BadRequest(new { error = "用户名不能为空" });
    if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 6)
        return Results.BadRequest(new { error = "密码至少 6 位" });
    if (await db.Staffs.AnyAsync(s => s.Username == username))
        return Results.BadRequest(new { error = "该用户名已存在" });

    var role = req.Role == "admin" ? "admin" : "viewer";
    var staff = new Staff
    {
        Id = Guid.NewGuid(),
        Username = username,
        PasswordHash = AuthUtil.HashPassword(req.Password),
        DisplayName = string.IsNullOrWhiteSpace(req.DisplayName) ? username : req.DisplayName.Trim(),
        Role = role,
        IsActive = true,
        CreatedAt = DateTime.UtcNow
    };
    db.Staffs.Add(staff);
    await db.SaveChangesAsync();
    return Results.Ok(new { staff.Id, staff.Username, staff.DisplayName, staff.Role, staff.IsActive });
});

app.MapPatch("/api/staff/{id:guid}", async (Guid id, StaffUpdateReq req, string? token, AppDbContext db, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    if (!me.IsAdmin) return Results.Json(new { error = "需要管理员权限" }, statusCode: 403);

    var staff = await db.Staffs.FirstOrDefaultAsync(s => s.Id == id);
    if (staff == null) return Results.NotFound();

    // 不允许把最后一个管理员降级或停用（防止把自己锁在门外）
    var willLoseAdmin = staff.Role == "admin" &&
        ((req.Role != null && req.Role != "admin") || req.IsActive == false);
    if (willLoseAdmin)
    {
        var activeAdmins = await db.Staffs.CountAsync(s => s.Role == "admin" && s.IsActive && s.Id != id);
        if (activeAdmins == 0)
            return Results.BadRequest(new { error = "这是最后一个管理员，不能降级或停用" });
    }

    if (req.DisplayName != null) staff.DisplayName = req.DisplayName.Trim();
    if (req.Role != null) staff.Role = req.Role == "admin" ? "admin" : "viewer";
    if (req.IsActive != null) staff.IsActive = req.IsActive.Value;
    var passwordChanged = false;
    if (!string.IsNullOrWhiteSpace(req.Password))
    {
        if (req.Password.Length < 6) return Results.BadRequest(new { error = "密码至少 6 位" });
        staff.PasswordHash = AuthUtil.HashPassword(req.Password);
        passwordChanged = true;
    }
    await db.SaveChangesAsync();

    // 改密或停用 → 踢掉该账号的所有会话
    if (passwordChanged || req.IsActive == false)
        await AuthUtil.ClearSessionsAsync(staff.Id, db);

    return Results.Ok(new { staff.Id, staff.Username, staff.DisplayName, staff.Role, staff.IsActive });
});

app.MapDelete("/api/staff/{id:guid}", async (Guid id, string? token, AppDbContext db, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    if (!me.IsAdmin) return Results.Json(new { error = "需要管理员权限" }, statusCode: 403);

    var staff = await db.Staffs.FirstOrDefaultAsync(s => s.Id == id);
    if (staff == null) return Results.NotFound();
    if (staff.Username == me.Username) return Results.BadRequest(new { error = "不能删除自己" });

    if (staff.Role == "admin")
    {
        var otherAdmins = await db.Staffs.CountAsync(s => s.Role == "admin" && s.IsActive && s.Id != id);
        if (otherAdmins == 0) return Results.BadRequest(new { error = "这是最后一个管理员，不能删除" });
    }

    await AuthUtil.ClearSessionsAsync(staff.Id, db);
    db.Staffs.Remove(staff);
    await db.SaveChangesAsync();
    return Results.Ok(new { ok = true });
});

// ============================== 评价 ==============================

// 客人提交评价（开放，无需令牌）
app.MapPost("/api/review", async (Review review, AppDbContext db) =>
{
    // --- 入参校验 ---
    // 这个接口是公开的（客人免登录提交），且经隧道暴露在公网，
    // 因此必须挡住"没有意义的请求"，否则空 body 也会被存成一条评价，污染统计。
    // 注意：光在这里判空是不够的——Type 字段一旦在模型上给了默认值，
    // 空 body 反序列化后就已经被填成默认值了（详见 Models/Review.cs 的注释）。
    var type = (review.Type ?? "").Trim().ToLowerInvariant();
    if (type != "positive" && type != "negative")
        return Results.BadRequest(new { error = "type 必须是 positive 或 negative" });

    var room = review.Room?.Trim();
    if (room != null && room.Length > 50)
        return Results.BadRequest(new { error = "房间号过长" });

    // 理由：去空、去重、限长，避免有人塞超长内容
    var reasons = (review.Reasons ?? new List<string>())
        .Select(r => (r ?? "").Trim())
        .Where(r => r.Length > 0)
        .Distinct()
        .Take(20)
        .Select(r => r.Length > 50 ? r[..50] : r)
        .ToList();

    var staff = review.StaffUsername?.Trim();
    if (staff != null && staff.Length > 50) staff = staff[..50];

    var staffName = review.StaffName?.Trim();
    if (staffName != null && staffName.Length > 50) staffName = staffName[..50];

    var entity = new Review
    {
        Id = Guid.NewGuid(),
        Type = type,
        Reasons = reasons,
        Room = string.IsNullOrWhiteSpace(room) ? null : room,
        StaffUsername = string.IsNullOrWhiteSpace(staff) ? null : staff,
        StaffName = string.IsNullOrWhiteSpace(staffName) ? null : staffName,
        CreatedAt = DateTime.UtcNow
    };
    db.Reviews.Add(entity);
    await db.SaveChangesAsync();
    return Results.Ok(entity);
}).RequireRateLimiting("review");

// ============================== 查询条件（明细与统计共用）==============================

// 把前端传来的 ISO 时刻解析成 UTC DateTime。
// 为什么由前端传"已经算好的时刻"而不是传 "2026-09-12" 让后端自己切：
// 旧系统是在浏览器里按**使用者本地时区**判定"这一天"的，服务器若在别的时区就会错一天。
// 前端把用户选的日期换算成当天的 0 点 / 23:59:59.999（本地）再转 ISO 传过来，语义就与旧系统一致。
static DateTime? ParseInstant(string? s)
{
    if (string.IsNullOrWhiteSpace(s)) return null;
    if (DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dto))
        return dto.UtcDateTime;
    return null;
}

static IQueryable<Review> ApplyRange(IQueryable<Review> q, DateTime? from, DateTime? to)
{
    if (from != null) q = q.Where(r => r.CreatedAt >= from.Value);
    if (to != null) q = q.Where(r => r.CreatedAt <= to.Value);
    return q;
}

// 周期键：与旧系统同一套格式 —— 天 YYYY-MM-DD、周 YYYY-Www、月 YYYY-MM。
// 周用 ISO 口径（周一起算），这样"周号"和日期落在同一周里，不会出现
// "周日那天被算进下一周"这种两套口径打架的情况（旧系统这里就是混用的）。
static string PeriodKey(DateTime utc, string period, int tzMinutes)
{
    var d = utc.AddMinutes(tzMinutes);
    return period switch
    {
        "week" => $"{ISOWeek.GetYear(d)}-W{ISOWeek.GetWeekOfYear(d):D2}",
        "month" => d.ToString("yyyy-MM"),
        _ => d.ToString("yyyy-MM-dd")
    };
}

// ============================== 明细 ==============================

// 后台查明细（需登录：管理员或查看者）。
// 返回**数组**（保持与旧版接口一致的形状）；命中总数放在 X-Total-Count 响应头里。
// 查询参数全部可选，多个条件是「与」关系 —— 与旧系统 queryReviews() 的语义一致：
//   start / end  ISO 时刻（前端按本地日期算好的当天边界）
//   type         positive | negative（其他值忽略，不报错）
//   reason       差评原因文本，命中「包含该原因」的记录
//   staff        操作工号，精确匹配
//   room         房间号，大小写不敏感精确匹配（1801a 能命中 1801A）
//   offset/limit 分页；不传 limit 则返回全部（老前端仍可正常调用）
app.MapGet("/api/reviews", async (AppDbContext db, string? token, IConfiguration cfg, HttpResponse res,
    string? start, string? end, string? type, string? reason, string? staff, string? room,
    int? offset, int? limit) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();

    var q = ApplyRange(db.Reviews.AsQueryable(), ParseInstant(start), ParseInstant(end));

    var t = (type ?? "").Trim().ToLowerInvariant();
    if (t == "positive" || t == "negative") q = q.Where(r => r.Type == t);

    var rs = (reason ?? "").Trim();
    if (rs.Length > 0) q = q.Where(r => r.Reasons.Contains(rs));

    var st = (staff ?? "").Trim();
    if (st.Length > 0) q = q.Where(r => r.StaffUsername == st);

    var rm = (room ?? "").Trim().ToUpper();
    if (rm.Length > 0) q = q.Where(r => r.Room != null && r.Room.ToUpper() == rm);

    var total = await q.CountAsync();
    res.Headers["X-Total-Count"] = total.ToString();

    var ordered = q.OrderByDescending(r => r.CreatedAt);
    var list = limit is > 0
        ? await ordered.Skip(offset is > 0 ? offset.Value : 0).Take(Math.Min(limit.Value, 500)).ToListAsync()
        : await ordered.ToListAsync();
    return Results.Ok(list);
});

// ============================== 统计 ==============================

// 总览统计（需登录）。不传日期=全量（旧行为），传了就只统计该区间。
app.MapGet("/api/stats", async (AppDbContext db, string? token, IConfiguration cfg,
    string? start, string? end) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    var all = await ApplyRange(db.Reviews.AsQueryable(), ParseInstant(start), ParseInstant(end)).ToListAsync();
    var total = all.Count;
    var positive = all.Count(r => r.Type == "positive");
    var negative = total - positive;
    return Results.Ok(new
    {
        total,
        positive,
        negative,
        positiveRate = total == 0 ? 0 : Math.Round((double)positive / total * 100, 1)
    });
});

// 按房间统计（差评优先排序）
app.MapGet("/api/stats/by-room", async (AppDbContext db, string? token, IConfiguration cfg,
    string? start, string? end) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    var all = await ApplyRange(db.Reviews.AsQueryable(), ParseInstant(start), ParseInstant(end)).ToListAsync();
    var groups = all
        .GroupBy(r => string.IsNullOrWhiteSpace(r.Room) ? "未记录" : r.Room)
        .Select(g => new
        {
            room = g.Key,
            total = g.Count(),
            positive = g.Count(r => r.Type == "positive"),
            negative = g.Count(r => r.Type != "positive")
        })
        .OrderByDescending(x => x.negative).ThenByDescending(x => x.total)
        .ToList();
    return Results.Ok(groups);
});

// 按员工工号统计（总量排序）。姓名取该工号下最近一条填过姓名的记录。
app.MapGet("/api/stats/by-staff", async (AppDbContext db, string? token, IConfiguration cfg,
    string? start, string? end) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    var all = await ApplyRange(db.Reviews.AsQueryable(), ParseInstant(start), ParseInstant(end)).ToListAsync();
    var groups = all
        .GroupBy(r => string.IsNullOrWhiteSpace(r.StaffUsername) ? "未记录" : r.StaffUsername)
        .Select(g => new
        {
            staff = g.Key,
            name = g.OrderByDescending(r => r.CreatedAt)
                    .Select(r => r.StaffName)
                    .FirstOrDefault(n => !string.IsNullOrWhiteSpace(n)) ?? "",
            total = g.Count(),
            positive = g.Count(r => r.Type == "positive"),
            negative = g.Count(r => r.Type != "positive")
        })
        .OrderByDescending(x => x.total)
        .ToList();
    return Results.Ok(groups);
});

// 按周期聚合（天/周/月），周期键升序 —— 对应旧系统 statsBy(period, start, end)。
// tz：使用者时区相对 UTC 的分钟数（东八区传 480）。周期归属按**使用者本地时间**算，
//     否则"凌晨 0-8 点的评价"会被算到前一天，与旧系统的表现不一致。
app.MapGet("/api/stats/by-period", async (AppDbContext db, string? token, IConfiguration cfg,
    string? period, int? tz, string? start, string? end) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();

    var p = (period ?? "day").Trim().ToLowerInvariant();
    if (p != "day" && p != "week" && p != "month") p = "day";
    // 兜底 ±14 小时，防脏参数
    var tzMinutes = Math.Clamp(tz ?? 0, -840, 840);

    var all = await ApplyRange(db.Reviews.AsQueryable(), ParseInstant(start), ParseInstant(end)).ToListAsync();
    var groups = all
        .GroupBy(r => PeriodKey(r.CreatedAt, p, tzMinutes))
        .Select(g => new
        {
            period = g.Key,
            total = g.Count(),
            positive = g.Count(r => r.Type == "positive"),
            negative = g.Count(r => r.Type != "positive")
        })
        .OrderBy(x => x.period, StringComparer.Ordinal)
        .ToList();
    return Results.Ok(groups);
});

// 差评原因排行（只统计差评，按原因文本计数，次数降序）—— 对应旧系统 negReasonStats()。
app.MapGet("/api/stats/by-reason", async (AppDbContext db, string? token, IConfiguration cfg,
    string? start, string? end) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    var all = await ApplyRange(db.Reviews.AsQueryable(), ParseInstant(start), ParseInstant(end)).ToListAsync();
    var groups = all
        .Where(r => r.Type != "positive")
        .SelectMany(r => r.Reasons ?? new List<string>())
        .Where(s => !string.IsNullOrWhiteSpace(s))
        .GroupBy(s => s)
        .Select(g => new { reason = g.Key, count = g.Count() })
        .OrderByDescending(x => x.count)
        .ToList();
    return Results.Ok(groups);
});

// ===== 品牌 LOGO（酒店管理人员可在后台上传自己的 LOGO）=====
// 存放目录：backend/branding/ （运行时数据，不入库不进 Git）
var logoDir = Path.Combine(app.Environment.ContentRootPath, "branding");
Directory.CreateDirectory(logoDir);
string? FindCustomLogo() => Directory.GetFiles(logoDir, "logo.*").FirstOrDefault();

// 读取当前 LOGO（开放访问：客人点评页也要显示）
app.MapGet("/api/settings/logo", () =>
{
    var f = FindCustomLogo();
    if (f == null) return Results.NotFound();
    var mime = Path.GetExtension(f).ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        _ => "application/octet-stream"
    };
    return Results.File(File.ReadAllBytes(f), mime);
});

// 上传 / 替换 LOGO（仅管理员）
app.MapPost("/api/settings/logo", async (HttpRequest req, string? token, AppDbContext db, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    if (!me.IsAdmin) return Results.Json(new { error = "需要管理员权限" }, statusCode: 403);
    if (!req.HasFormContentType) return Results.BadRequest(new { error = "请求需为 multipart/form-data" });

    var form = await req.ReadFormAsync();
    var file = form.Files.FirstOrDefault();
    if (file == null || file.Length == 0) return Results.BadRequest(new { error = "未收到图片文件" });

    const long maxBytes = 2 * 1024 * 1024;
    if (file.Length > maxBytes) return Results.BadRequest(new { error = "图片不能超过 2MB" });

    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
    string[] allowed = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
    if (!allowed.Contains(ext)) return Results.BadRequest(new { error = "仅支持 png / jpg / webp / gif" });

    foreach (var old in Directory.GetFiles(logoDir, "logo.*"))
    {
        try { File.Delete(old); } catch { /* 忽略占用中的旧文件 */ }
    }

    var target = Path.Combine(logoDir, "logo" + ext);
    await using (var fs = File.Create(target))
    {
        await file.CopyToAsync(fs);
    }
    return Results.Ok(new { ok = true, version = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
});

// 恢复默认 LOGO（仅管理员）
app.MapDelete("/api/settings/logo", async (string? token, AppDbContext db, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    if (!me.IsAdmin) return Results.Json(new { error = "需要管理员权限" }, statusCode: 403);

    foreach (var old in Directory.GetFiles(logoDir, "logo.*"))
    {
        try { File.Delete(old); } catch { }
    }
    return Results.Ok(new { ok = true });
});

// ===== 可配置项（酒店名称 / 文案 / 好评与差评原因列表）=====

// 开放读取：客人点评页要渲染它，不能要求令牌
app.MapGet("/api/settings/public", async (AppDbContext db) =>
{
    var s = await SettingsStore.LoadAsync(db);
    return Results.Ok(new
    {
        hotelName = s.HotelName,
        hotelNameEn = s.HotelNameEn,
        guestPrompt = s.GuestPrompt,
        positiveMsg = s.PositiveMsg,
        negativeMsg = s.NegativeMsg,
        positiveReasons = s.PositiveReasons,
        negativeReasons = s.NegativeReasons,
        autoReturn = s.AutoReturn,
    });
});

// 后台读取（需登录）。内容与公开接口一致，单独留这个入口是为了
// 将来要放"非公开配置"时不必改动前端调用方式。
app.MapGet("/api/settings", async (string? token, AppDbContext db, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    return Results.Ok(await SettingsStore.LoadAsync(db));
});

// 保存（仅管理员）
app.MapPut("/api/settings", async (SiteSettings req, string? token, AppDbContext db, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    if (!me.IsAdmin) return Results.Json(new { error = "需要管理员权限" }, statusCode: 403);

    var err = req.NormalizeAndValidate();
    if (err != null) return Results.BadRequest(new { error = err });

    await SettingsStore.SaveAsync(db, req);
    return Results.Ok(await SettingsStore.LoadAsync(db));
});

app.Run();

// ============================== 请求体 DTO ==============================
record LoginReq(string? Username, string? Password);
record PasswordReq(string? OldPassword, string? NewPassword);
record StaffCreateReq(string? Username, string? Password, string? DisplayName, string? Role);
record StaffUpdateReq(string? DisplayName, string? Role, bool? IsActive, string? Password);
