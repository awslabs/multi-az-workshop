using Xunit;
using BAMCIS.MultiAZApp.Utilities;

namespace BAMCIS.MultiAZApp.Tests.Utilities
{
    public class ConstantsTests
    {
        [Fact]
        public void LogGroupName_HasCorrectValue()
        {
            Assert.Equal("/multi-az-workshop/frontend", Constants.LOG_GROUP_NAME);
        }

        [Fact]
        public void XRaySegmentName_HasCorrectValue()
        {
            Assert.Equal("multi-az-workshop-front-end", Constants.XRAY_SEGMENT_NAME);
        }

        [Fact]
        public void ServiceName_HasCorrectValue()
        {
            Assert.Equal("multi-az-workshop", Constants.SERVICE_NAME);
        }

        [Fact]
        public void MetricNamespace_HasCorrectValue()
        {
            Assert.Equal("multi-az-workshop/frontend", Constants.METRIC_NAMESPACE);
        }

        [Fact]
        public void MetricNamespaceOneBox_HasCorrectValue()
        {
            Assert.Equal("multi-az-workshop/frontend/onebox", Constants.METRIC_NAMESPACE_ONE_BOX);
        }
    }
}
