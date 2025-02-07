// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using Amazon;
using Amazon.CloudWatch.EMF.Logger;
using Amazon.CloudWatch.EMF.Model;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace BAMCIS.MultiAZApp.Utils
{
    public class CacheRefreshWorker : IWorker
    {
        private readonly ILogger<CacheRefreshWorker> logger;
        private readonly IMemoryCache cache;
        private readonly Stopwatch stopwatch = new Stopwatch();
        private static readonly IAmazonSecretsManager client;
        private static readonly int delayMilliseconds = 60000; // 1 minute
        private static readonly int clientTimeoutSeconds = 4;

        static CacheRefreshWorker()
        {
            client = new AmazonSecretsManagerClient(region: RegionEndpoint.GetBySystemName(EnvironmentUtils.GetRegion()));
        }

        public CacheRefreshWorker(ILogger<CacheRefreshWorker> logger, IMemoryCache cache)
        {
            this.logger = logger;
            this.cache = cache;
        }

        public async Task DoWork(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                using (var metrics = new MetricsLogger())
                {
                    this.stopwatch.Restart();
                    ConfigureMetricsLogger(metrics);
                    metrics.PutProperty("LoggerSetupLatency", this.stopwatch.Elapsed.TotalMilliseconds);

                    var ts = this.stopwatch.Elapsed;
                    int val = await RefreshCacheAsync(metrics, cancellationToken);

                    // This is a more precise measurement, typically varies 0.01 - 0.005 ms versus 2.0 - 0.1 ms measuring from
                    // inside the called method, but likely also includes context switching time, which could skew the success
                    // and fault metrics a bit
                    if (val == 0)
                    {
                        metrics.PutMetric("SuccessLatency", (this.stopwatch.Elapsed - ts).TotalMilliseconds, Unit.MILLISECONDS);
                    }
                    else if (val == 1) 
                    {
                        metrics.PutMetric("FaultLatency", (this.stopwatch.Elapsed - ts).TotalMilliseconds, Unit.MILLISECONDS);
                    }

                    ts = this.stopwatch.Elapsed;
                    metrics.PutMetric("TotalLatency", ts.TotalMilliseconds, Unit.MILLISECONDS);
                    this.stopwatch.Stop();
                }

                await Task.Delay(delayMilliseconds, cancellationToken);
            }
        }

        private async Task<int> RefreshCacheAsync(IMetricsLogger metrics, CancellationToken cancellationToken)
        {
            var ts = this.stopwatch.Elapsed;

            DateTime now = DateTime.UtcNow;
            metrics.PutProperty("Now", now.ToString("yyyy-MM-ddTHH:mm:ss.ffffZ"));

            DateTime lastUpdate;
            DateTime nextUpdate = now;

            if (cache.TryGetValue("LastCacheRefresh", out lastUpdate))
            {
                nextUpdate = lastUpdate.AddMilliseconds(delayMilliseconds);
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

            cache.Set("LastCacheRefresh", now);
            metrics.PutProperty("CacheRefresh", true);
            
            try
            {
                string connectionString = await GetConnectionStringAsync();
                this.cache.Set("ConnectionString", connectionString);            
                metrics.PutMetric("Fault", 0, Unit.COUNT);
                metrics.PutMetric("Success", 1, Unit.COUNT);
                metrics.PutMetric("Error", 0, Unit.COUNT);
                return 0;
            }
            catch (Exception ex)
            {
                this.cache.Set("ConnectionString", "");
                metrics.PutMetric("Fault", 1, Unit.COUNT);
                metrics.PutMetric("Success", 0, Unit.COUNT);
                metrics.PutMetric("Error", 0, Unit.COUNT);
                LogError(metrics, ex, "Failed to retrieve connection string.");
                return 1;
            }
        }

        private static void ConfigureMetricsLogger(IMetricsLogger metrics)
        {
            metrics.SetNamespace(EnvironmentUtils.IsOneBox() ? Constants.METRIC_NAMESPACE_ONE_BOX : Constants.METRIC_NAMESPACE);
            metrics.PutProperty("Ec2InstanceId", EnvironmentUtils.GetInstanceId());
            metrics.PutProperty("Operation", "CacheRefresh");

            if (EnvironmentUtils.IsOneBox())
            {
                var regionDimensions = new DimensionSet();

                regionDimensions.AddDimension("Region", EnvironmentUtils.GetRegion());

                metrics.PutProperty("AZ-ID", EnvironmentUtils.GetAZId());
                metrics.PutProperty("InstanceId", EnvironmentUtils.GetHostId());

                metrics.SetDimensions(regionDimensions);
            }
            else
            {
                var regionDimensions = new DimensionSet();
                var regionAZDimensions = new DimensionSet();
                var regionAZInstanceIdDimensions = new DimensionSet();

                regionAZInstanceIdDimensions.AddDimension("Region", EnvironmentUtils.GetRegion());
                regionAZDimensions.AddDimension("Region", EnvironmentUtils.GetRegion());
                regionDimensions.AddDimension("Region", EnvironmentUtils.GetRegion());

                regionAZDimensions.AddDimension("AZ-ID", EnvironmentUtils.GetAZId());
                regionAZInstanceIdDimensions.AddDimension("AZ-ID", EnvironmentUtils.GetAZId());

                regionAZInstanceIdDimensions.AddDimension("InstanceId", EnvironmentUtils.GetHostId());

                metrics.SetDimensions(regionAZInstanceIdDimensions, regionAZDimensions, regionDimensions);
            }
        }

        private static async Task<string> GetConnectionStringAsync()
        {      
            string secretId;

            //if (File.Exists("/etc/secret"))
            //{
                secretId = File.ReadAllText("/etc/secret").Trim();
            //}
            //else {
            //    secretId = System.Environment.GetEnvironmentVariable("DB_SECRET");
            //}

            if (String.IsNullOrEmpty(secretId))
            {
                throw new ResourceNotFoundException("Was unable to read DB secret id from file or environment variable.");
            }

            var request = new GetSecretValueRequest
            {
                SecretId = secretId,
                VersionStage = "AWSCURRENT"
            };

            var response = await client.GetSecretValueAsync(request);
            var secrets = JsonConvert.DeserializeObject<Dictionary<string, string>>(response.SecretString);

            return $"Host={secrets["host"]};Port={secrets["port"]};Username={secrets["username"]};" +
                   $"Password={secrets["password"]};Database={secrets["dbname"]};Timeout={clientTimeoutSeconds};";
        }

        private void LogError(IMetricsLogger metrics, Exception ex, string message)
        {
            try {
                logger.LogError(ex, message);
                metrics.PutProperty("ErrorMessage", ex.Message);
            }
            catch (Exception e) {
                Console.WriteLine(ex.Message);
                Console.WriteLine(e.Message);
            }
        }
    }
}
