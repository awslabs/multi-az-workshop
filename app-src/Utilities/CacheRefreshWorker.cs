// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using Amazon;
using Amazon.CloudWatch.EMF.Logger;
using Amazon.CloudWatch.EMF.Model;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;
using Microsoft.Extensions.Caching.Memory;
using Newtonsoft.Json;
using System.Diagnostics;

namespace BAMCIS.MultiAZApp.Utilities
{
    public class CacheRefreshWorker : IWorker
    {
        private readonly ILogger<CacheRefreshWorker> _logger;
        private readonly IMemoryCache _cache;
        private readonly Stopwatch _stopwatch = new Stopwatch();
        private readonly IAmazonSecretsManager _client;
        private readonly IEnvironment _environment;
        private static readonly int _delayMilliseconds = 60000; // 1 minute
        private static readonly int _clientTimeoutSeconds = 2;

        static CacheRefreshWorker()
        {
            
        }

        public CacheRefreshWorker(ILogger<CacheRefreshWorker> logger, IMemoryCache cache, IEnvironment environment)
        {
            this._client = new AmazonSecretsManagerClient(region: RegionEndpoint.GetBySystemName(environment.GetRegion()));
            this._logger = logger;
            this._cache = cache;
            this._environment = environment;
        }

        public async Task DoWork(CancellationToken cancellationToken)
        {
            string hostId = this._environment.GetHostId();
            string instanceId = this._environment.GetInstanceId();
            string region = this._environment.GetRegion();
            string azId = this._environment.GetAZId();
            string az = this._environment.GetAZ();
            bool oneBox = this._environment.IsOneBox();

            while (!cancellationToken.IsCancellationRequested)
            {
                using (var metrics = new MetricsLogger())
                {
                    this._stopwatch.Restart();
                    metrics.SetNamespace(oneBox ? Constants.METRIC_NAMESPACE_ONE_BOX : Constants.METRIC_NAMESPACE);
                    
                    metrics.PutProperty("HostId", hostId);
                    metrics.PutProperty("Operation", "CacheRefresh");

                    if (oneBox)
                    {
                        metrics.PutProperty("InstanceId", instanceId);
                        metrics.PutProperty("AZ-ID", azId); 

                        var regionDimensions = new DimensionSet();
                        regionDimensions.AddDimension("Region", region);
                        metrics.SetDimensions(regionDimensions);
                    }
                    else
                    {
                        var regionDimensions = new DimensionSet();
                        var regionAZDimensions = new DimensionSet();
                        var regionAZInstanceIdDimensions = new DimensionSet();

                        regionAZInstanceIdDimensions.AddDimension("Region", region);
                        regionAZDimensions.AddDimension("Region", region);
                        regionDimensions.AddDimension("Region", region);

                        regionAZDimensions.AddDimension("AZ-ID", azId);
                        regionAZInstanceIdDimensions.AddDimension("AZ-ID", azId);

                        regionAZInstanceIdDimensions.AddDimension("InstanceId", instanceId);

                        metrics.SetDimensions(
                            regionAZInstanceIdDimensions, 
                            regionAZDimensions, 
                            regionDimensions
                        );
                    }

                    var ts = this._stopwatch.Elapsed;
                    int val = await RefreshCacheAsync(metrics, cancellationToken);

                    // This is a more precise measurement, typically varies 0.01 - 0.005 ms versus 2.0 - 0.1 ms measuring from
                    // inside the called method, but likely also includes context switching time, which could skew the success
                    // and fault metrics a bit
                    if (val == 0)
                    {
                        metrics.PutMetric("SuccessLatency", (this._stopwatch.Elapsed - ts).TotalMilliseconds, Unit.MILLISECONDS);
                    }
                    else if (val == 1) 
                    {
                        metrics.PutMetric("FaultLatency", (this._stopwatch.Elapsed - ts).TotalMilliseconds, Unit.MILLISECONDS);
                    }

                    ts = this._stopwatch.Elapsed;
                    metrics.PutMetric("TotalLatency", ts.TotalMilliseconds, Unit.MILLISECONDS);
                    this._stopwatch.Stop();
                }

                await Task.Delay(_delayMilliseconds, cancellationToken);
            }
        }

        private async Task<int> RefreshCacheAsync(IMetricsLogger metrics, CancellationToken cancellationToken)
        {
            var ts = this._stopwatch.Elapsed;

            DateTime now = DateTime.UtcNow;
            metrics.PutProperty("Now", now.ToString("yyyy-MM-ddTHH:mm:ss.ffffZ"));

            DateTime lastUpdate;
            DateTime nextUpdate = now;

            if (this._cache.TryGetValue("LastCacheRefresh", out lastUpdate))
            {
                nextUpdate = lastUpdate.AddMilliseconds(_delayMilliseconds);
            }
         
            metrics.PutProperty("LastCacheRefresh", lastUpdate.ToString("yyyy-MM-ddTHH:mm:ss.ffffZ"));
            metrics.PutProperty("NextCacheUpdateTime", nextUpdate.ToString("yyyy-MM-ddTHH:mm:ss.ffffZ"));

            if (nextUpdate > now)
            {
                metrics.PutProperty("CacheRefresh", false);
                metrics.PutMetric("Fault", 0, Unit.COUNT);
                metrics.PutMetric("Success", 1, Unit.COUNT);
                metrics.PutMetric("Error", 0, Unit.COUNT);
                return 2;
            }

            this._cache.Set("LastCacheRefresh", now);
            metrics.PutProperty("CacheRefresh", true);
            
            try
            {
                string connectionString = await GetConnectionStringAsync();
                this._cache.Set("ConnectionString", connectionString);            
                metrics.PutMetric("Fault", 0, Unit.COUNT);
                metrics.PutMetric("Success", 1, Unit.COUNT);
                metrics.PutMetric("Error", 0, Unit.COUNT);
                return 0;
            }
            catch (Exception ex)
            {
                this._cache.Set("ConnectionString", "");
                metrics.PutMetric("Fault", 1, Unit.COUNT);
                metrics.PutMetric("Success", 0, Unit.COUNT);
                metrics.PutMetric("Error", 0, Unit.COUNT);
                LogError(metrics, ex, "Failed to retrieve connection string.");
                return 1;
            }
        }

        private async Task<string> GetConnectionStringAsync()
        {      
            string secretId;

            if (File.Exists("/etc/secret"))
            {
                secretId = File.ReadAllText("/etc/secret").Trim();
            }
            else {
                secretId = System.Environment.GetEnvironmentVariable("DB_SECRET");
            }

            if (String.IsNullOrEmpty(secretId))
            {
                throw new ResourceNotFoundException("Was unable to read DB secret id from file or environment variable.");
            }

            var request = new GetSecretValueRequest
            {
                SecretId = secretId,
                VersionStage = "AWSCURRENT"
            };

            var response = await this._client.GetSecretValueAsync(request);
            var secrets = JsonConvert.DeserializeObject<Dictionary<string, string>>(response.SecretString);

            return $"Host={secrets["host"]};Port={secrets["port"]};Username={secrets["username"]};" +
                   $"Password={secrets["password"]};Database={secrets["dbname"]};Timeout={_clientTimeoutSeconds};";
        }

        private void LogError(IMetricsLogger metrics, Exception ex, string message)
        {
            try {
                this._logger.LogError(ex, message);
                metrics.PutProperty("ErrorMessage", ex.Message);
            }
            catch (Exception e) {
                Console.WriteLine(ex.Message);
                Console.WriteLine(e.Message);
            }
        }
    }
}
