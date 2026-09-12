using Microsoft.EntityFrameworkCore;
using HotelReview.Api.Data;
using HotelReview.Api.Models;

var builder = WebApplication.CreateBuilder(args);

// 后端监听端口（前端 vite 代理指向这里）
builder.WebHost.UseUrls("http://localhost:5188");

// PostgreSQL 连接（连接串在 appsettings.json 的 ConnectionStrings:DefaultConnection）
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddCors();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();
app.UseCors(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());

// 启动时自动建表（开发期用 EnsureCreated；生产可用 migration）
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
}

// 客人提交评价（开放，无需令牌）
app.MapPost("/api/review", async (Review review, AppDbContext db) =>
{
    review.Id = Guid.NewGuid();
    review.CreatedAt = DateTime.UtcNow;
    db.Reviews.Add(review);
    await db.SaveChangesAsync();
    return Results.Ok(review);
});

// 后台拉全量（需管理员令牌）
app.MapGet("/api/reviews", async (AppDbContext db, string? token, IConfiguration cfg) =>
{
    if (token != cfg["AdminToken"]) return Results.Unauthorized();
    var list = await db.Reviews.OrderByDescending(r => r.CreatedAt).ToListAsync();
    return Results.Ok(list);
});

// 后台统计（需管理员令牌）
app.MapGet("/api/stats", async (AppDbContext db, string? token, IConfiguration cfg) =>
{
    if (token != cfg["AdminToken"]) return Results.Unauthorized();
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
    if (token != cfg["AdminToken"]) return Results.Unauthorized();
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
    if (token != cfg["AdminToken"]) return Results.Unauthorized();
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

app.Run();
