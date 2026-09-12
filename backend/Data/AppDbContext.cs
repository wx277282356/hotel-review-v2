using Microsoft.EntityFrameworkCore;
using HotelReview.Api.Models;

namespace HotelReview.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Review> Reviews => Set<Review>();
}
