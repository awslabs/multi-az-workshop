// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
using System;
using System.Collections.Generic;
using System.Linq;

namespace Amazon.AWSLabs.MultiAZWorkshop.Constructs
{
    public class NetworkBuilder
    {
        public CidrBlock NetworkCidr {get;}
        private List<CidrBlock> SubnetCidrs {get;}
        private long NextAvailableIp {get; set;}

        public NetworkBuilder(string cidr)
        {
            this.NetworkCidr = new CidrBlock(cidr);
            this.SubnetCidrs = new List<CidrBlock>();
            this.NextAvailableIp = this.NetworkCidr.MinAddress();
        }

        public string AddSubnet(int mask)
        {
            return AddSubnets(mask, 1).First();
        }

        public IEnumerable<string> AddSubnets(int mask, int count = 1)
        {
            if (mask < 16 || mask > 28)
            {
                throw new Exception($"/{mask} is not a valid network mask.");
            }

            long maxIp = this.NextAvailableIp + (CidrBlock.CalculateNetSize(mask) * count);

            if (this.NetworkCidr.MaxAddress() < maxIp - 1)
            {
                throw new Exception($"{count} of /{mask} exceeds remaining space of ${this.NetworkCidr.Cidr}.");
            }

            List<CidrBlock> newSubnets = new List<CidrBlock>();

            for (int i = 0; i < count; i++)
            {
                CidrBlock subnet = new CidrBlock(this.NextAvailableIp, mask);
                this.NextAvailableIp = subnet.NextBlock().MinAddress();
                this.SubnetCidrs.Add(subnet);
                newSubnets.Add(subnet);
            }

            return newSubnets.Select(x => x.Cidr);
        }

        public IEnumerable<string> GetCidrs() 
        {
            return this.SubnetCidrs.Select(x => x.Cidr);
        }

        /// <summary>
        /// Calculates the largest subnet to create of the given count from the remaining IP space
        /// </summary>
        /// <param name="subnetCount"></param>
        /// <returns></returns>
        public int MaskForRemainingSubnets(int subnetCount)
        {
            long remaining = this.NetworkCidr.MaxAddress() - this.NextAvailableIp + 1;
            int ipsPerSubnet = (int)Math.Floor(remaining / (double)subnetCount);
            return 32 - (int)Math.Floor(Math.Log2(ipsPerSubnet));
        }
    }

    public class CidrBlock
    {
        public string Cidr {get;}
        public int Mask {get;}
        public long NetworkSize {get;}

        /// <summary>
        /// The network address provided in CIDR creation offset by the Netsize - 1
        /// </summary>
        public long NetworkAddress {get;}

        public CidrBlock(string cidr) {
            this.Mask = Int32.Parse(cidr.Split("/")[1]);
            this.NetworkAddress = IpToNumber(cidr.Split("/")[0]) + CalculateNetSize(this.Mask) - 1;
            this.NetworkSize = (long)Math.Pow(2, 32 - this.Mask);
            this.Cidr = $"{this.MinIP()}/{this.Mask}";
        }

        public CidrBlock(long ipAddress, int mask) {
            this.Mask = mask;
            this.NetworkAddress = ipAddress + CalculateNetSize(this.Mask) - 1;
            this.NetworkSize = (long)Math.Pow(2, 32 - this.Mask);
            this.Cidr = $"{this.MinIP()}/{this.Mask}";
        }

        public string MinIP() {
            return NumberToIp(this.MinAddress());
        }

        public string MaxIP() {
            return NumberToIp(this.MaxAddress());
        }

        public long MinAddress() {
            long div = this.NetworkAddress % this.NetworkSize;
            return this.NetworkAddress - div;
        }

        public long MaxAddress() {
            // min + (2^(32-mask)) - 1 [zero needs to count]
            return this.MinAddress() + this.NetworkSize - 1;
        }

        public CidrBlock NextBlock() {
            return new CidrBlock(this.MaxAddress() + 1, this.Mask);
        }

        public bool ContainsCidr(CidrBlock other) {
            return (this.MaxAddress() >= other.MaxAddress()) && 
                (this.MinAddress() <= other.MinAddress());
        }

        public static string CalculateNetworkMask(int mask) {
            return NumberToIp((long)Math.Pow(2, 32) - (long)Math.Pow(2, 32 - mask));
        }

        public static int CalculateNetSize(int mask) {
            return (int)Math.Pow(2, 32 - mask);
        }

        public static long IpToNumber(string ipAddress) {
            if (!IsValidIp(ipAddress)) {
                throw new Exception($"{ipAddress} is not a valid IP address.");
            }

            long num = 0;
            int[] parts = ipAddress.Split(".").Select(x => Int32.Parse(x)).ToArray();
            for (int i = 0; i < parts.Length; i++) {
                num += parts[i] * (long)Math.Pow(256, 3 - i);
            }

            return num;
        }
        
        public static string NumberToIp(long ipNumber) {
            long remaining = ipNumber;
            int[] address = new int[4];
            for (int i = 0; i < 4; i++) {
                if (remaining != 0) {
                    address[i] = (int)Math.Floor(remaining / Math.Pow(256, 3 - i));
                    remaining %= (long)Math.Pow(256, 3 - i);
                }
                else {
                    address[i] = 0;
                }
            }

            string ipAddress = String.Join(".", address);

            if (!IsValidIp(ipAddress)) {
                throw new Exception($"{ipAddress} is not a valid IP address.");
            }
            return ipAddress;
        }

        public static bool IsValidIp(string ipAddress) {
            string[] octets = ipAddress.Split(".");
            if (octets.Length != 4) {
                return false;
            }
            foreach (string octet in octets) {
                
                int tmp = Int32.Parse(octet);
                if (tmp > 255 || tmp < 0) {
                    return false;
                }
            }

            return true;
        }
    }
}