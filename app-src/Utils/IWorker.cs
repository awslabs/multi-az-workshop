// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

using System.Threading;
using System.Threading.Tasks;

namespace BAMCIS.MultiAZApp.Utils
{
    public interface IWorker
    {
        public Task DoWork(CancellationToken cancellationToken);
    }
}
