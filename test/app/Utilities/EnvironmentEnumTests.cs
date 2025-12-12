using Xunit;
using BAMCIS.MultiAZApp.Utilities;
using AppEnvironment = BAMCIS.MultiAZApp.Utilities.Environment;

namespace BAMCIS.MultiAZApp.Tests.Utilities
{
    public class EnvironmentEnumTests
    {
        [Fact]
        public void Environment_HasLocalValue()
        {
            var env = AppEnvironment.LOCAL;
            Assert.Equal(AppEnvironment.LOCAL, env);
        }

        [Fact]
        public void Environment_HasEC2Value()
        {
            var env = AppEnvironment.EC2;
            Assert.Equal(AppEnvironment.EC2, env);
        }

        [Fact]
        public void Environment_HasECSValue()
        {
            var env = AppEnvironment.ECS;
            Assert.Equal(AppEnvironment.ECS, env);
        }

        [Fact]
        public void Environment_HasEKSValue()
        {
            var env = AppEnvironment.EKS;
            Assert.Equal(AppEnvironment.EKS, env);
        }

        [Fact]
        public void Environment_HasLambdaValue()
        {
            var env = AppEnvironment.LAMBDA;
            Assert.Equal(AppEnvironment.LAMBDA, env);
        }

        [Fact]
        public void Environment_AllValuesAreDifferent()
        {
            Assert.NotEqual(AppEnvironment.LOCAL, AppEnvironment.EC2);
            Assert.NotEqual(AppEnvironment.LOCAL, AppEnvironment.ECS);
            Assert.NotEqual(AppEnvironment.LOCAL, AppEnvironment.EKS);
            Assert.NotEqual(AppEnvironment.LOCAL, AppEnvironment.LAMBDA);
            Assert.NotEqual(AppEnvironment.EC2, AppEnvironment.ECS);
            Assert.NotEqual(AppEnvironment.EC2, AppEnvironment.EKS);
            Assert.NotEqual(AppEnvironment.EC2, AppEnvironment.LAMBDA);
            Assert.NotEqual(AppEnvironment.ECS, AppEnvironment.EKS);
            Assert.NotEqual(AppEnvironment.ECS, AppEnvironment.LAMBDA);
            Assert.NotEqual(AppEnvironment.EKS, AppEnvironment.LAMBDA);
        }
    }
}
