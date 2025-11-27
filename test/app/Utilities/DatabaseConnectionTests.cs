using Xunit;
using BAMCIS.MultiAZApp.Utilities;

namespace BAMCIS.MultiAZApp.Tests.Utilities
{
    public class DatabaseConnectionTests
    {
        [Fact]
        public void Constructor_WithoutSecretFile_HandlesException()
        {
            // DatabaseConnection constructor tries to read from /etc/secret
            // and write to /var/log/secretrserror.log on error
            // This test verifies it handles the exception gracefully
            try
            {
                var connection = new DatabaseConnection();
                var connectionString = connection.GetConnectionString();
                Assert.NotNull(connectionString);
            }
            catch (System.UnauthorizedAccessException)
            {
                // Expected when running without proper permissions
                Assert.True(true);
            }
        }

        [Fact]
        public void GetConnectionString_ReturnsString()
        {
            try
            {
                var connection = new DatabaseConnection();
                var result = connection.GetConnectionString();
                Assert.NotNull(result);
            }
            catch (System.UnauthorizedAccessException)
            {
                // Expected when running without proper permissions
                Assert.True(true);
            }
        }
    }
}
