using System;
using System.Collections.Generic;
using Microsoft.Extensions.Logging;

namespace BAMCIS.MultiAZApp.Utils
{
    public class EC2Environment : BaseEnvironment, IEnvironment
    {
        private const string INSTANCE_IDENTITY_URL = "http://169.254.169.254/latest/dynamic/instance-identity/document";
        private const string TOKEN_URL = "http://169.254.169.254/latest/api/token";
        private const string TOKEN_REQUEST_HEADER_KEY = "X-aws-ec2-metadata-token-ttl-seconds";
        private const string TOKEN_REQUEST_HEADER_VALUE = "21600";
        private const string METADATA_REQUEST_HEADER_KEY = "X-aws-ec2-metadata-token";

        private string _token;

        public EC2Environment(ILogger logger) : base (logger, new ResourceFetcher())
        {

        }

        public EC2Environment(ILogger logger, IResourceFetcher fetcher) : base(logger, fetcher)
        {

        }

        public override string GetHostId()
        {
            return this.GetInstanceId();
        }

        public override bool Probe()
        {
            Uri tokenUri = null;
            var tokenRequestHeader = new Dictionary<string, string>();
            tokenRequestHeader.Add(TOKEN_REQUEST_HEADER_KEY, TOKEN_REQUEST_HEADER_VALUE);
            
            try
            {
                tokenUri = new Uri(TOKEN_URL);
            }
            catch (Exception)
            {
                _logger.LogDebug("Failed to construct url: " + TOKEN_URL);
                return false;
            }

            try
            {
                _token = _fetcher.FetchString(tokenUri, "PUT", tokenRequestHeader);
            }
            catch (Exception ex)
            {
                _logger.LogDebug("Failed to get response from: " + tokenUri, ex);
                return false;
            }

            Uri metadataUri = null;
            var metadataRequestHeader = new Dictionary<string, string>();
            metadataRequestHeader.Add(METADATA_REQUEST_HEADER_KEY, _token);

            try
            {
                metadataUri = new Uri(INSTANCE_IDENTITY_URL);
            }
            catch (Exception)
            {
                _logger.LogDebug("Failed to construct url: " + INSTANCE_IDENTITY_URL);
                return false;
            }

            try
            {

                //_ec2Metadata = _fetcher.FetchJson<EC2Metadata>(metadataUri, "GET", metadataRequestHeader);
                _fetcher.FetchString(metadataUri, "GET", metadataRequestHeader);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogDebug("Failed to get response from: " + metadataUri, ex);
            }

            return false;
        }

        public override Environment GetEnvironmentType()
        {
            return Environment.EC2;
        }
    }
}