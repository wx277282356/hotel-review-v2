using Microsoft.EntityFrameworkCore;
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

// 后端监听端口（前端 vite 代理指向这里）
builder.WebHost.UseUrls("http://localhost:5188");

// PostgreSQL 连接
builder.Services.AddDbContext<AppDbContext>(opt => opt.UseNpgsql(connStr));

builder.Services.AddCors();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();
app.UseCors(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());

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
});

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
    review.Id = Guid.NewGuid();
    review.CreatedAt = DateTime.UtcNow;
    db.Reviews.Add(review);
    await db.SaveChangesAsync();
    return Results.Ok(review);
});

// 后台拉全量（需登录：管理员或查看者）
app.MapGet("/api/reviews", async (AppDbContext db, string? token, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    var list = await db.Reviews.OrderByDescending(r => r.CreatedAt).ToListAsync();
    return Results.Ok(list);
});

// 后台统计（需登录）
app.MapGet("/api/stats", async (AppDbContext db, string? token, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    var all = await db.Reviews.ToListAsync();
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
app.MapGet("/api/stats/by-room", async (AppDbContext db, string? token, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    var all = await db.Reviews.ToListAsync();
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

// 按员工工号统计（总量排序）
app.MapGet("/api/stats/by-staff", async (AppDbContext db, string? token, IConfiguration cfg) =>
{
    var me = await AuthUtil.ResolveAsync(token, db, cfg);
    if (me == null) return Results.Unauthorized();
    var all = await db.Reviews.ToListAsync();
    var groups = all
        .GroupBy(r => string.IsNullOrWhiteSpace(r.StaffUsername) ? "未记录" : r.StaffUsername)
        .Select(g => new
        {
            staff = g.Key,
            total = g.Count(),
            positive = g.Count(r => r.Type == "positive"),
            negative = g.Count(r => r.Type != "positive")
        })
        .OrderByDescending(x => x.total)
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

app.Run();

// ============================== 请求体 DTO ==============================
record LoginReq(string? Username, string? Password);
record PasswordReq(string? OldPassword, string? NewPassword);
record StaffCreateReq(string? Username, string? Password, string? DisplayName, string? Role);
record StaffUpdateReq(string? DisplayName, string? Role, bool? IsActive, string? Password);
