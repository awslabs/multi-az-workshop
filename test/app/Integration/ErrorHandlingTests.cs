using Xunit;
using Microsoft.AspNetCore.Mvc.Testing;
using System.Net;

namespace BAMCIS.MultiAZApp.Tests.Integration
{
    public class ErrorHandlingTests : IClassFixture<TestWebApplicationFactory<Program>>
    {
        private readonly TestWebApplicationFactory<Program> _factory;
        private readonly HttpClient _client;

        public ErrorHandlingTests(TestWebApplicationFactory<Program> factory)
        {
            _factory = factory;
            _client = factory.CreateClient();
        }

        [Fact]
        public async Task NonExistentEndpoint_Returns404()
        {
            var response = await _client.GetAsync("/nonexistent");

            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }

        [Fact]
        public async Task RideEndpoint_WithoutConnectionString_ReturnsError()
        {
            var response = await _client.GetAsync("/ride");

            // Should return 404 or 500 depending on cache state
            Assert.True(
                response.StatusCode == HttpStatusCode.NotFound ||
                response.StatusCode == HttpStatusCode.InternalServerError);
        }

        [Fact]
        public async Task RideEndpoint_ErrorResponse_ContainsJson()
        {
            var response = await _client.GetAsync("/ride");

            var content = await response.Content.ReadAsStringAsync();
            
            // Error responses should still be JSON
            Assert.Contains("{", content);
            Assert.Contains("}", content);
        }

        [Fact]
        public async Task Application_HandlesInvalidHttpMethod()
        {
            var request = new HttpRequestMessage(HttpMethod.Post, "/health");
            var response = await _client.SendAsync(request);

            // Should return 405 Method Not Allowed
            Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
        }

        [Fact]
        public async Task Application_HandlesLargeNumberOfRequests()
        {
            var tasks = new List<Task<HttpResponseMessage>>();

            for (int i = 0; i < 100; i++)
            {
                tasks.Add(_client.GetAsync("/health"));
            }

            var responses = await Task.WhenAll(tasks);

            // All requests should complete successfully
            Assert.All(responses, response =>
            {
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            });
        }

        [Fact]
        public async Task Application_HandlesRapidSequentialRequests()
        {
            for (int i = 0; i < 20; i++)
            {
                var response = await _client.GetAsync("/health");
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            }
        }

        [Fact]
        public async Task ErrorResponse_ContainsEnvironmentInformation()
        {
            var response = await _client.GetAsync("/ride");

            var content = await response.Content.ReadAsStringAsync();
            
            // Even error responses should contain environment info
            Assert.Contains("region", content);
            Assert.Contains("azId", content);
        }
    }
}
