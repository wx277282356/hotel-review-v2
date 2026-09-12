namespace HotelReview.Api.Models;

public class Review
{
    public Guid Id { get; set; }

    // ⚠️ 这里刻意**不给默认值**。
    // 因为本模型直接用于开放接口 POST /api/review 的入参绑定：
    // 若写成 `= "positive"`，那么空 body `{}` 反序列化后 Type 会被自动填成 "positive"，
    // 于是一个没有任何意义的请求也会被当成"一条好评"存进库，污染统计。
    // 置为 null! 后，缺字段时绑定结果是 null，交给接口层校验并拒绝。
    public string Type { get; set; } = null!; // positive | negative

    public List<string> Reasons { get; set; } = new();
    public string? Room { get; set; }
    public string? StaffUsername { get; set; }

    // 提交时的员工姓名（旧系统也有这个字段，用在明细的"操作工号"列与按工号统计里）。
    // 与 StaffUsername 一样允许为空：客人自己手机扫码提交时没有登录态。
    public string? StaffName { get; set; }

    public DateTime CreatedAt { get; set; }
}
