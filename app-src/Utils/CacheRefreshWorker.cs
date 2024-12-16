// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

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
        private readonly Stopwatch stopwatch;

        public CacheRefreshWorker(ILogger<CacheRefreshWorker> logger, IMemoryCache cache) : base()
        {
            this.logger = logger;
            this.cache = cache;
            this.stopwatch = new Stopwatch();
        }

        public async Task DoWork(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                using (var metrics = new MetricsLogger())
                {
                    LoggerSetup(metrics);
                    this.stopwatch.Restart();

                    try
                    {
                        if (this.cache.TryGetValue("LastCacheRefresh", out DateTime lastUpdate))
                        {
                            var nextUpdate = lastUpdate.AddMinutes(5);
                            var now = DateTime.UtcNow;
                            metrics.PutProperty("LastCacheRefresh", lastUpdate.ToString("yyyy-MM-ddTHH:mm:ss.ffffZ"));
                            metrics.PutProperty("NextCacheUpdateTime", nextUpdate.ToString("yyyy-MM-ddTHH:mm:ss.ffffZ"));
                            metrics.PutProperty("Now", now.ToString("yyyy-MM-ddTHH:mm:ss.ffffZ"));

                            if (nextUpdate < now)
                            {
                                metrics.PutProperty("CacheRefresh", true);
                                this.cache.Set<DateTime>("LastCacheRefresh", now);

                                try 
                                {
                                    string val = File.ReadAllText("/etc/secret").Trim();

                                    if (!String.IsNullOrEmpty(val))
                                    {
                                        Dictionary<string, string> secrets = await GetSecret(val);
                                        string connectionString = $"Host={secrets["host"]};Port={secrets["port"]};Username={secrets["username"]};Password={secrets["password"]};Database={secrets["dbname"]};Timeout=4;";  
                                        this.cache.Set<string>("ConnectionString", connectionString);
                                    } 
                                    else
                                    {
                                        this.cache.Set<string>("ConnectionString", "");
                                    }
                                }
                                catch (Exception e)
                                {
                                    this.cache.Set<string>("ConnectionString", "");
                                    File.AppendAllText("/var/log/secretrserror.log", e.Message);
                                }  
                            }
                            else
                            {
                                metrics.PutProperty("CacheRefresh", false);
                                // Only wait if we didn't need to refresh the cache
                                // if we do refresh it, it will loop back through immediately
                                // see that we don't need to refresh yet, then come to here
                                // and sleep
                                await Task.Delay(1000 * 300); // Wait 5 minutes
                            }
                        }
                        else
                        {
                            metrics.PutProperty("CacheRefresh", false);
                            this.cache.Set<DateTime>("LastCacheRefresh", DateTime.MinValue.ToUniversalTime());
                        }
                    }
                    catch (Exception e)
                    {
                        metrics.PutProperty("GetSecretValueFailure", e.Message);
                        // also sleep here in case there is a transient error
                        await Task.Delay(1000 * 300); // Wait 5 minutes
                    }
                    finally
                    {
                        this.stopwatch.Stop();
                        metrics.PutMetric("CacheRefreshLatency", this.stopwatch.ElapsedMilliseconds, Unit.MILLISECONDS);
                    }
                }
            }
        }

        private static void LoggerSetup(IMetricsLogger metrics)
        {
            if (EnvironmentUtils.IsOneBox())
            {
                metrics.SetNamespace("multi-az-workshop/frontend/onebox");

                var regionDimensions = new DimensionSet();

                regionDimensions.AddDimension("Region", EnvironmentUtils.GetRegion());

                metrics.PutProperty("AZ-ID", EnvironmentUtils.GetAZId());
                metrics.PutProperty("InstanceId", EnvironmentUtils.GetHostId());
                metrics.PutProperty("Ec2InstanceId", EnvironmentUtils.GetInstanceId());

                metrics.SetDimensions(regionDimensions);
            }
            else
            {
                metrics.SetNamespace("multi-az-workshop/frontend");

                var regionDimensions = new DimensionSet();
                var regionAZDimensions = new DimensionSet();
                var regionAZInstanceIdDimensions = new DimensionSet();

                regionAZInstanceIdDimensions.AddDimension("Region", EnvironmentUtils.GetRegion());
                regionAZDimensions.AddDimension("Region", EnvironmentUtils.GetRegion());
                regionDimensions.AddDimension("Region", EnvironmentUtils.GetRegion());

                regionAZDimensions.AddDimension("AZ-ID", EnvironmentUtils.GetAZId());
                regionAZInstanceIdDimensions.AddDimension("AZ-ID", EnvironmentUtils.GetAZId());

                regionAZInstanceIdDimensions.AddDimension("InstanceId", EnvironmentUtils.GetHostId());

                metrics.PutProperty("Ec2InstanceId", EnvironmentUtils.GetInstanceId());

                metrics.SetDimensions(regionAZInstanceIdDimensions, regionAZDimensions, regionDimensions);
            }
        }

        private static async Task<Dictionary<string, string>> GetSecret(string secretName)
        {
            IAmazonSecretsManager client = new AmazonSecretsManagerClient();

            GetSecretValueRequest request = new GetSecretValueRequest
            {
                SecretId = secretName,
                VersionStage = "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified.
            };

            GetSecretValueResponse response = await client.GetSecretValueAsync(request);
            string secret = response.SecretString;

            return JsonConvert.DeserializeObject<Dictionary<string, string>>(secret);           
        } 
    }
}
