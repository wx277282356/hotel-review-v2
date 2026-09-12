using Microsoft.EntityFrameworkCore;
using HotelReview.Api.Models;

namespace HotelReview.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Review> Reviews => Set<Review>();
    public DbSet<Staff> Staffs => Set<Staff>();
    public DbSet<Session> Sessions => Set<Session>();

    protected override void OnModelCreating(ModelBuilder mb)
    {
        mb.Entity<Staff>().HasIndex(s => s.Username).IsUnique();
        mb.Entity<Session>().HasKey(s => s.Token);
    }
}
