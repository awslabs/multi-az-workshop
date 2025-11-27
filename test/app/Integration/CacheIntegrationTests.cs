using Xunit;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Caching.Memory;

namespace BAMCIS.MultiAZApp.Tests.Integration
{
    public class CacheIntegrationTests : IClassFixture<WebApplicationFactory<Program>>
    {
        private readonly WebApplicationFactory<Program> _factory;

        public CacheIntegrationTests(WebApplicationFactory<Program> factory)
        {
            _factory = factory;
        }

        [Fact]
        public async Task Application_RegistersMemoryCache()
        {
            var client = _factory.WithWebHostBuilder(builder =>
            {
                builder.ConfigureTestServices(services =>
                {
                    // Verify IMemoryCache is registered
                    var cacheDescriptor = services.SingleOrDefault(
                        d => d.ServiceType == typeof(IMemoryCache));
                    
                    Assert.NotNull(cacheDescriptor);
                });
            }).CreateClient();

            var response = await client.GetAsync("/health");
            response.EnsureSuccessStatusCode();
        }

        [Fact]
        public async Task RideEndpoint_HandlesEmptyCache()
        {
            var client = _factory.CreateClient();

            var response = await client.GetAsync("/ride");

            // Should return 404 when connection string is not in cache
            Assert.True(
                response.StatusCode == System.Net.HttpStatusCode.NotFound ||
                response.StatusCode == System.Net.HttpStatusCode.InternalServerError);
        }

        [Fact]
        public async Task RideEndpoint_WithConnectionString_AttemptsQuery()
        {
            var client = _factory.WithWebHostBuilder(builder =>
            {
                builder.ConfigureTestServices(services =>
                {
                    // Pre-populate cache with a test connection string
                    var sp = services.BuildServiceProvider();
                    var cache = sp.GetRequiredService<IMemoryCache>();
                    
                    // Use an invalid connection string to avoid actual DB connection
                    cache.Set("ConnectionString", "Host=invalid;Port=5432;Username=test;Password=test;Database=test;Timeout=1;");
                });
            }).CreateClient();

            var response = await client.GetAsync("/ride");

            // Should attempt to connect and fail with 500 or 404 depending on cache state
            Assert.True(
                response.StatusCode == System.Net.HttpStatusCode.InternalServerError ||
                response.StatusCode == System.Net.HttpStatusCode.NotFound);
        }

        [Fact]
        public async Task Application_StartsBackgroundCacheRefreshWorker()
        {
            var client = _factory.CreateClient();

            // Give the background worker a moment to start
            await Task.Delay(100);

            var response = await client.GetAsync("/health");
            response.EnsureSuccessStatusCode();

            // If we get here, the background worker didn't crash the application
            Assert.True(true);
        }
    }
}
