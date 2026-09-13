using HotelReview.Api.Data;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace HotelReview.Api.Models;

/// <summary>
/// 全站可配置项。整份序列化成 JSON 存在 "AppSettings" 表的单行里。
///
/// ⚠️ 本结构会通过【开放接口】/api/settings/public 直接返回给客人点评页，
///    因此**绝不要在这里放任何机密字段**（令牌、密码、连接串等）。
///    将来若有非公开配置，请在后台接口里单独返回，不要塞进这个类。
/// </summary>
public class SiteSettings
{
    public const int MaxNameLength = 50;   // 酒店名称
    public const int MaxTextLength = 60;   // 各种提示语
    public const int MaxReasonsCount = 20; // 原因选项个数
    public const int MaxReasonLength = 20; // 单个原因选项字数

    public string HotelName { get; set; } = "城市酒店";
    public string HotelNameEn { get; set; } = "";
    public string GuestPrompt { get; set; } = "请您为本次入住体验评分";
    public string PositiveMsg { get; set; } = "感谢您的反馈！";
    public string NegativeMsg { get; set; } = "已收到您的反馈，我们会立即改进！";

    /// <summary>
    /// 客人提交后感谢页自动返回的秒数（旧系统叫 autoReturn）。
    /// 范围 2–10，超出自动钳制；默认 4。前端倒计时文案用到它。
    /// </summary>
    public int AutoReturn { get; set; } = 4;

    /// <summary>
    /// Q14：客人页界面语言。'zh' = 仅中文（默认）；'en' = 仅英文；'both' = 中英同屏。
    /// 仅影响前端固定 UI 文案（按钮/弹窗标题等），后台配置的内容型文案（提示语/原因/感谢语）
    /// 仍按管理员填写原文显示，因为这些没有翻译来源。
    /// </summary>
    public string Lang { get; set; } = "zh";

    /// <summary>
    /// Q13：语音播报开关。默认关；后台可开。开启后客人页 30 秒首次播报欢迎语、
    /// 之后每 60 秒重复一次（用浏览器 SpeechSynthesis，无需后端资源）。
    /// </summary>
    public bool VoiceEnabled { get; set; } = false;

    public List<string> PositiveReasons { get; set; } = new()
    {
        "服务态度好", "房间干净", "设施完善", "位置方便", "性价比高", "早餐丰富"
    };

    public List<string> NegativeReasons { get; set; } = new()
    {
        "服务态度差", "房间不干净", "设施故障", "噪音大", "网络差", "其他"
    };

    /// <summary>
    /// 校验并就地归一化（trim / 去空 / 去重）。
    /// 返回 null 表示通过；否则返回给用户看的中文错误说明。
    /// </summary>
    public string? NormalizeAndValidate()
    {
        HotelName = (HotelName ?? "").Trim();
        HotelNameEn = (HotelNameEn ?? "").Trim();
        GuestPrompt = (GuestPrompt ?? "").Trim();
        PositiveMsg = (PositiveMsg ?? "").Trim();
        NegativeMsg = (NegativeMsg ?? "").Trim();

        if (HotelName.Length == 0) return "酒店名称不能为空";
        if (HotelName.Length > MaxNameLength) return $"酒店名称不能超过 {MaxNameLength} 个字";
        if (HotelNameEn.Length > MaxNameLength) return $"英文名不能超过 {MaxNameLength} 个字";
        if (GuestPrompt.Length > MaxTextLength) return $"客人页提示语不能超过 {MaxTextLength} 个字";
        if (PositiveMsg.Length > MaxTextLength) return $"好评提示语不能超过 {MaxTextLength} 个字";
        if (NegativeMsg.Length > MaxTextLength) return $"差评提示语不能超过 {MaxTextLength} 个字";

        // 自动返回秒数：钳制到 2–10（旧系统的可设范围）
        if (AutoReturn < 2) AutoReturn = 2;
        else if (AutoReturn > 10) AutoReturn = 10;

        // 语言：只接受 zh / en / both，其余回落中文
        if (Lang != "zh" && Lang != "en" && Lang != "both") Lang = "zh";

        var pos = Sanitize(PositiveReasons, "好评原因", out var e1);
        if (e1 != null) return e1;
        PositiveReasons = pos!;

        var neg = Sanitize(NegativeReasons, "差评原因", out var e2);
        if (e2 != null) return e2;
        NegativeReasons = neg!;

        return null;
    }

    private static List<string>? Sanitize(List<string>? src, string label, out string? error)
    {
        error = null;
        var list = new List<string>();
        if (src != null)
        {
            foreach (var raw in src)
            {
                var s = (raw ?? "").Trim();
                if (s.Length == 0) continue;
                if (s.Length > MaxReasonLength)
                {
                    error = $"{label}「{s}」太长：每项不能超过 {MaxReasonLength} 个字";
                    return null;
                }
                if (!list.Contains(s)) list.Add(s);
            }
        }
        if (list.Count > MaxReasonsCount)
        {
            error = $"{label}最多 {MaxReasonsCount} 项";
            return null;
        }
        return list;
    }
}

/// <summary>单行存储（Id 恒为 1），Data 是 SiteSettings 的 JSON。</summary>
public class AppSettingsRow
{
    public int Id { get; set; }
    public string Data { get; set; } = "{}";
    public DateTime UpdatedAt { get; set; }
}

/// <summary>读写配置。任何异常都退回内置默认值，保证客人页永远打得开。</summary>
public static class SettingsStore
{
    private const int RowId = 1;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public static async Task<SiteSettings> LoadAsync(AppDbContext db)
    {
        try
        {
            var row = await db.AppSettings.AsNoTracking().FirstOrDefaultAsync(r => r.Id == RowId);
            if (row == null || string.IsNullOrWhiteSpace(row.Data)) return new SiteSettings();
            return JsonSerializer.Deserialize<SiteSettings>(row.Data, JsonOpts) ?? new SiteSettings();
        }
        catch
        {
            // 配置损坏不该让客人页打不开
            return new SiteSettings();
        }
    }

    public static async Task SaveAsync(AppDbContext db, SiteSettings s)
    {
        var json = JsonSerializer.Serialize(s, JsonOpts);
        var row = await db.AppSettings.FirstOrDefaultAsync(r => r.Id == RowId);
        if (row == null)
        {
            db.AppSettings.Add(new AppSettingsRow { Id = RowId, Data = json, UpdatedAt = DateTime.UtcNow });
        }
        else
        {
            row.Data = json;
            row.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync();
    }
}
