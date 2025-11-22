// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public enum IPAddressType : UInt32
    {
        IPv4 = 0,
        DualStack = 1,
        IPv6 = 2
    }
}