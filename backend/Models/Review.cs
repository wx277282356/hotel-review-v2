namespace HotelReview.Api.Models;

public class Review
{
    public Guid Id { get; set; }
    public string Type { get; set; } = "positive"; // positive | negative
    public List<string> Reasons { get; set; } = new();
    public string? Room { get; set; }
    public string? StaffUsername { get; set; }
    public DateTime CreatedAt { get; set; }
}
