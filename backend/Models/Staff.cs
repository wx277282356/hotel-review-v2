namespace HotelReview.Api.Models;

/// <summary>后台账号（酒店员工）</summary>
public class Staff
{
    public Guid Id { get; set; }

    /// <summary>登录名（唯一）</summary>
    public string Username { get; set; } = "";

    /// <summary>PBKDF2 密码哈希（格式：saltBase64.keyBase64）</summary>
    public string PasswordHash { get; set; } = "";

    /// <summary>显示名（如"张店长"）</summary>
    public string DisplayName { get; set; } = "";

    /// <summary>角色：admin（管理员，全权）/ viewer（查看者，只读统计与明细）</summary>
    public string Role { get; set; } = "viewer";

    /// <summary>是否启用（停用后无法登录，历史评价不受影响）</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; }
}
