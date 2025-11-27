using Xunit;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using BAMCIS.MultiAZApp.Utilities;
using Amazon.CloudWatch.EMF.Logger;

namespace BAMCIS.MultiAZApp.Tests.Integration
{
    public class MiddlewarePipelineTests : IClassFixture<WebApplicationFactory<Program>>
    {
        private readonly WebApplicationFactory<Program> _factory;

        public MiddlewarePipelineTests(WebApplicationFactory<Program> factory)
        {
            _factory = factory;
        }

        [Fact]
        public async Task Middleware_AddsCustomHeaders()
        {
            var client = _factory.CreateClient();

            var response = await client.GetAsync("/health");

            Assert.True(response.Headers.Contains("X-Server-Side-Latency"));
            Assert.True(response.Headers.Contains("X-RequestId"));
        }

        [Fact]
        public async Task Middleware_PreservesTraceId()
        {
            var client = _factory.CreateClient();
            var traceId = "Root=1-67890-abcdef";
            
            var request = new HttpRequestMessage(HttpMethod.Get, "/health");
            request.Headers.Add("X-Amzn-Trace-Id", traceId);

            var response = await client.SendAsync(request);

            Assert.True(response.Headers.Contains("X-Amzn-Trace-Id"));
        }

        [Fact]
        public async Task Middleware_HandlesInvocationId()
        {
            var client = _factory.CreateClient();
            var invocationId = "test-invocation-123";
            
            var request = new HttpRequestMessage(HttpMethod.Get, "/health");
            request.Headers.Add("X-Invocation-Id", invocationId);

            var response = await client.SendAsync(request);

            Assert.True(response.Headers.Contains("X-Invocation-Id"));
            var returnedId = response.Headers.GetValues("X-Invocation-Id").First();
            Assert.Equal(invocationId, returnedId);
        }

        [Fact]
        public async Task Middleware_HandlesLambdaRequestId()
        {
            var client = _factory.CreateClient();
            var lambdaRequestId = "lambda-request-456";
            
            var request = new HttpRequestMessage(HttpMethod.Get, "/health");
            request.Headers.Add("X-Lambda-RequestId", lambdaRequestId);

            var response = await client.SendAsync(request);

            Assert.True(response.Headers.Contains("X-Lambda-RequestId"));
            var returnedId = response.Headers.GetValues("X-Lambda-RequestId").First();
            Assert.Equal(lambdaRequestId, returnedId);
        }

        [Fact]
        public async Task Application_UsesEnvironmentProvider()
        {
            var mockEnvironment = new Mock<IEnvironment>();
            mockEnvironment.Setup(e => e.GetRegion()).Returns("test-region");
            mockEnvironment.Setup(e => e.GetAZId()).Returns("test-az-id");
            mockEnvironment.Setup(e => e.GetInstanceId()).Returns("test-instance");
            mockEnvironment.Setup(e => e.GetHostId()).Returns("test-host");

            var client = _factory.WithWebHostBuilder(builder =>
            {
                builder.ConfigureTestServices(services =>
                {
                    services.AddSingleton(mockEnvironment.Object);
                });
            }).CreateClient();

            var response = await client.GetAsync("/health");
            var content = await response.Content.ReadAsStringAsync();

            Assert.Contains("test-region", content);
            Assert.Contains("test-az-id", content);
        }

        [Fact]
        public async Task Application_RegistersBackgroundServices()
        {
            var client = _factory.CreateClient();

            // Just verify the application starts successfully with background services
            var response = await client.GetAsync("/health");
            
            response.EnsureSuccessStatusCode();
        }

        [Fact]
        public async Task Application_HandlesMultipleConcurrentRequests()
        {
            var client = _factory.CreateClient();
            var tasks = new List<Task<HttpResponseMessage>>();

            for (int i = 0; i < 10; i++)
            {
                tasks.Add(client.GetAsync("/health"));
            }

            var responses = await Task.WhenAll(tasks);

            Assert.All(responses, response => 
            {
                Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);
            });
        }
    }
}
