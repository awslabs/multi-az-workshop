// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

namespace BAMCIS.MultiAZApp.Utilities
{
    public interface IWorker
    {
        public Task DoWork(CancellationToken cancellationToken);
    }
}
