// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

namespace Amazon.AWSLabs.MultiAZWorkshop
{
    public enum EvacuationMethod 
    {
        // Use ARC routing controls
        ARC,

        // Use ARC zonal shift
        ZonalShift,

        // Use self-managed S3
        SelfManagedHttpEndpoint_S3,

        // Use self-managed API Gateway
        SelfManagedHttpEndpoint_APIG
    }
}