using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using BAMCIS.MultiAZApp.Utilities;

namespace BAMCIS.MultiAZApp.Tests.Integration
{
    /// <summary>
    /// Custom WebApplicationFactory for integration tests that disables problematic services
    /// </summary>
    public class TestWebApplicationFactory<TProgram> : WebApplicationFactory<TProgram> where TProgram : class
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.ConfigureServices(services =>
            {
                // Clear all existing service registrations that might cause AWS connections
                var servicesToRemove = services.Where(d => 
                    (d.ServiceType == typeof(IHostedService) && d.ImplementationType == typeof(BackgroundWorker)) ||
                    (d.ServiceType == typeof(IWorker) && d.ImplementationType == typeof(CacheRefreshWorker))
                ).ToList();
                
                foreach (var service in servicesToRemove)
                {
                    services.Remove(service);
                }
                
                // Add a mock worker that doesn't make AWS calls
                services.AddSingleton<IWorker, MockCacheRefreshWorker>();
            });

            // Use Development environment to ensure EMF logs to stdout
            builder.UseEnvironment("Development");
            
            // Override configuration to prevent any AWS service initialization
            builder.ConfigureAppConfiguration((context, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["AWS_REGION"] = "us-east-1",
                    ["ENVIRONMENT"] = "Testing",
                    ["DB_SECRET_ID"] = "test-secret-id"
                });
            });
        }
    }

    /// <summary>
    /// Mock implementation of CacheRefreshWorker that doesn't make AWS calls
    /// </summary>
    public class MockCacheRefreshWorker : IWorker
    {
        private readonly ILogger<MockCacheRefreshWorker> _logger;

        public MockCacheRefreshWorker(ILogger<MockCacheRefreshWorker> logger)
        {
            _logger = logger;
        }

        public Task DoWork(CancellationToken cancellationToken)
        {
            _logger.LogInformation("Mock cache refresh worker - no AWS calls made");
            return Task.CompletedTask;
        }
    }
}