// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using Amazon.CloudWatch.EMF.Logger;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using System.Diagnostics;
using Newtonsoft.Json;
using Npgsql;
using Amazon.CloudWatch.EMF.Model;
using System.Net.Mime; // Don't delete, needed for FAIL

namespace BAMCIS.MultiAZApp.Controllers
{
    [ApiController]
    [Route("/")]
    public class HomeController : ControllerBase
    {
        private readonly ILogger<HomeController> logger;
        private readonly IMetricsLogger metrics;
        private readonly Random rand;
        private IMemoryCache cache;

        private ObjectResult DoWork() {
            Thread.Sleep(this.rand.Next(1, 20));
            this.Response.ContentType = MediaTypeNames.Application.Json;

            return Ok(new { 
                statusCode = 200
            });
        }

        private ObjectResult DoWorkProbelm() {
            Thread.Sleep(this.rand.Next(1, 20));
            this.Response.ContentType = MediaTypeNames.Application.Json;

            return Problem(
                statusCode: 500, 
                type: null, 
                detail: JsonConvert.SerializeObject(
                    new { 
                        statusCode = 500
                    }
                )
            );
        }

        public HomeController(ILogger<HomeController> logger, IMetricsLogger metrics, IMemoryCache cache)
        {
            this.logger = logger;
            this.metrics = metrics;
            this.rand = new Random();
            this.cache = cache;
        }

        // GET: /health
        [Route("health")]
        [HttpGet]
        public IActionResult HealthCheck()
        {
            return DoWork();
        }

        // GET: /home
        [Route("home")]
        [HttpGet]
        public IActionResult Home()
        {
            return DoWork();
        }

        // GET: /signin
        [Route("signin")]
        [HttpGet]
        public IActionResult Signin()
        {
            return DoWork();
        }

        // GET: /pay
        [Route("pay")]
        [HttpGet]
        public IActionResult Pay()
        {
            #if FAIL
                return DoWorkProbelm();
            #else
                return DoWork();
            #endif
        }

        // GET: /ride
        [Route("ride")]
        [HttpGet]
        public async Task<IActionResult> Ride()
        {
            this.Response.ContentType = MediaTypeNames.Application.Json;
            if (this.cache.TryGetValue<string>("ConnectionString", out var connString) && !String.IsNullOrEmpty(connString))
            {
                try {  
                    await using var dataSource = NpgsqlDataSource.Create(connString);
                    await using var command = dataSource.CreateCommand("SELECT tablename FROM pg_tables");
                    Stopwatch sw = new Stopwatch();
                    sw.Start();

                    await using var reader = await command.ExecuteReaderAsync();

                    List<string> content = new List<string>();
                    while (await reader.ReadAsync())
                    {
                        content.Add(reader.GetString(0));
                    }

                    sw.Stop();
                    this.metrics.PutMetric("QueryLatency", sw.ElapsedMilliseconds, Unit.MILLISECONDS);

                    return Ok(
                        new { 
                            statusCode = 200,
                            tables = content.ToArray() 
                        }
                    );
                }
                catch (Exception e)
                {
                    this.metrics.PutProperty("Exception", e);
                    return Problem(
                        detail: JsonConvert.SerializeObject(
                            new { 
                                statusCode = 500, 
                                exception = e 
                            }
                        ), statusCode: 500, type: null);
                }
            }
            else
            {
                this.metrics.PutProperty("Exception", "No connection string.");
                return Problem(
                    detail: JsonConvert.SerializeObject(new { 
                        statusCode = 404, 
                        problem = "Connection string was empty, check secrets manager configuration." }
                    ), statusCode: 404, type: null);
            }
        }
    }
}
