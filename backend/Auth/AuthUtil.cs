using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using HotelReview.Api.Data;
using HotelReview.Api.Models;

namespace HotelReview.Api.Auth;

/// <summary>已通过鉴权的身份</summary>
public record AuthInfo(string Role, string Username, string DisplayName)
{
    public bool IsAdmin => Role == "admin";
}

public static class AuthUtil
{
    private const int SaltSize = 16;
    private const int KeySize = 32;
    private const int Iterations = 100_000;

    /// <summary>生成 PBKDF2 密码哈希，格式：saltBase64.keyBase64</summary>
    public static string HashPassword(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, KeySize);
        return Convert.ToBase64String(salt) + "." + Convert.ToBase64String(key);
    }

    /// <summary>校验密码（定长时间比较，防时序攻击）</summary>
    public static bool VerifyPassword(string password, string stored)
    {
        if (string.IsNullOrEmpty(stored)) return false;
        var parts = stored.Split('.');
        if (parts.Length != 2) return false;
        try
        {
            var salt = Convert.FromBase64String(parts[0]);
            var expected = Convert.FromBase64String(parts[1]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch
        {
            return false;
        }
    }

    public static string NewToken() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();

    /// <summary>
    /// 解析令牌为身份：
    ///  · 主令牌（appsettings.json 的 AdminToken）→ 超级管理员（后门，防管理员忘密锁死）
    ///  · 登录下发的会话令牌 → 对应员工的角色
    /// 返回 null 表示未通过鉴权。
    /// </summary>
    public static async Task<AuthInfo?> ResolveAsync(string? token, AppDbContext db, IConfiguration cfg)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        var master = cfg["AdminToken"];
        if (!string.IsNullOrEmpty(master) && token == master)
            return new AuthInfo("admin", "admin", "超级管理员");

        var session = await db.Sessions.FirstOrDefaultAsync(s => s.Token == token);
        if (session == null || session.ExpiresAt <= DateTime.UtcNow) return null;

        var staff = await db.Staffs.FirstOrDefaultAsync(s => s.Id == session.StaffId);
        if (staff == null || !staff.IsActive) return null;

        return new AuthInfo(staff.Role, staff.Username, staff.DisplayName);
    }

    /// <summary>清掉某员工的全部会话（改密/停用/删除时调用）</summary>
    public static async Task ClearSessionsAsync(Guid staffId, AppDbContext db, string? keepToken = null)
    {
        var list = await db.Sessions.Where(s => s.StaffId == staffId).ToListAsync();
        foreach (var s in list)
        {
            if (keepToken != null && s.Token == keepToken) continue;
            db.Sessions.Remove(s);
        }
        await db.SaveChangesAsync();
    }
}
