using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
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
                // Remove the hosted background service that causes AWS connection issues
                var hostedServiceDescriptor = services.SingleOrDefault(
                    d => d.ServiceType == typeof(IHostedService) && 
                         d.ImplementationType == typeof(BackgroundWorker));
                
                if (hostedServiceDescriptor != null)
                {
                    services.Remove(hostedServiceDescriptor);
                }

                // Replace the CacheRefreshWorker with a mock that doesn't call AWS
                var workerDescriptor = services.SingleOrDefault(
                    d => d.ServiceType == typeof(IWorker));
                
                if (workerDescriptor != null)
                {
                    services.Remove(workerDescriptor);
                }
                
                // Add a mock worker that doesn't make AWS calls
                services.AddSingleton<IWorker, MockCacheRefreshWorker>();
            });

            builder.UseEnvironment("Testing");
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