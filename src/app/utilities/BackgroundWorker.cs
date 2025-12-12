// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using Microsoft.Extensions.Hosting;
using System.Threading;
using System.Threading.Tasks;

namespace BAMCIS.MultiAZApp.Utilities
{
    public class BackgroundWorker : BackgroundService
    {
        private readonly IWorker worker;

        public BackgroundWorker(IWorker worker)
        {
            this.worker = worker;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            await this.worker.DoWork(stoppingToken);
        }

        /* These are only needed if you directly implement IHostedService
        public async Task StartAsync(CancellationToken cancellationToken)
        {
            cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            await worker.DoWork(cancellationToken);
        }

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            cts.Cancel();
            return Task.CompletedTask; 
        }
        */
    }
}
