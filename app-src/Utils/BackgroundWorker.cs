// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using Microsoft.Extensions.Hosting;
using System.Threading;
using System.Threading.Tasks;

namespace BAMCIS.MultiAZApp.Utils
{
    public class BackgroundWorker : IHostedService
    {
        private readonly IWorker worker;

        public BackgroundWorker(IWorker worker)
        {
            this.worker = worker;
        }

        public async Task StartAsync(CancellationToken cancellationToken)
        {
            await worker.DoWork(cancellationToken);
        }

        public Task StopAsync(CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }
    }
}
