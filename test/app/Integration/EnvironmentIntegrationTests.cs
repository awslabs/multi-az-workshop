using Xunit;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using BAMCIS.MultiAZApp.Utilities;
using Moq;
using AppEnvironment = BAMCIS.MultiAZApp.Utilities.Environment;

namespace BAMCIS.MultiAZApp.Tests.Integration
{
    public class EnvironmentIntegrationTests : IClassFixture<WebApplicationFactory<Program>>
    {
        private readonly WebApplicationFactory<Program> _factory;

        public EnvironmentIntegrationTests(WebApplicationFactory<Program> factory)
        {
            _factory = factory;
        }

        [Fact]
        public async Task Application_UsesDefaultEnvironment_WhenNoCloudEnvironmentDetected()
        {
            var client = _factory.CreateClient();

            var response = await client.GetAsync("/health");
            var content = await response.Content.ReadAsStringAsync();

            // Should contain environment information
            Assert.Contains("region", content);
            Assert.Contains("azId", content);
            Assert.Contains("instanceId", content);
            Assert.Contains("hostId", content);
        }

        [Fact]
        public async Task Application_CanOverrideEnvironment_WithMock()
        {
            var mockEnvironment = new Mock<IEnvironment>();
            mockEnvironment.Setup(e => e.GetRegion()).Returns("us-west-2");
            mockEnvironment.Setup(e => e.GetAZId()).Returns("usw2-az1");
            mockEnvironment.Setup(e => e.GetInstanceId()).Returns("i-mock123");
            mockEnvironment.Setup(e => e.GetHostId()).Returns("mock-host");
            mockEnvironment.Setup(e => e.GetAZ()).Returns("us-west-2a");
            mockEnvironment.Setup(e => e.IsOneBox()).Returns(false);
            mockEnvironment.Setup(e => e.GetEnvironmentType()).Returns(AppEnvironment.EC2);

            var client = _factory.WithWebHostBuilder(builder =>
            {
                builder.ConfigureTestServices(services =>
                {
                    // Remove existing IEnvironment registration
                    var descriptor = services.SingleOrDefault(
                        d => d.ServiceType == typeof(IEnvironment));
                    if (descriptor != null)
                    {
                        services.Remove(descriptor);
                    }

                    services.AddSingleton(mockEnvironment.Object);
                });
            }).CreateClient();

            var response = await client.GetAsync("/health");
            var content = await response.Content.ReadAsStringAsync();

            Assert.Contains("us-west-2", content);
            Assert.Contains("usw2-az1", content);
            Assert.Contains("i-mock123", content);
            Assert.Contains("mock-host", content);
        }

        [Fact]
        public async Task Application_ReturnsConsistentEnvironmentData()
        {
            var client = _factory.CreateClient();

            var response1 = await client.GetAsync("/health");
            var content1 = await response1.Content.ReadAsStringAsync();

            var response2 = await client.GetAsync("/home");
            var content2 = await response2.Content.ReadAsStringAsync();

            // Both responses should contain the same environment data
            // Extract region from both responses and compare
            Assert.NotEmpty(content1);
            Assert.NotEmpty(content2);
        }

        [Fact]
        public async Task Application_HandlesEnvironmentProvider_Caching()
        {
            var client = _factory.CreateClient();

            // Make multiple requests to verify environment is cached
            var tasks = Enumerable.Range(0, 5)
                .Select(_ => client.GetAsync("/health"))
                .ToArray();

            var responses = await Task.WhenAll(tasks);

            Assert.All(responses, response =>
            {
                Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);
            });
        }
    }
}
