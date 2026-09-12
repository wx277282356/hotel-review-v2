namespace HotelReview.Api.Models;

/// <summary>登录会话（登录后下发的不透明令牌，前端以 ?token= 传递）</summary>
public class Session
{
    public string Token { get; set; } = "";
    public Guid StaffId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
}
