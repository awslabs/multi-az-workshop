---
title : "Lab 2: Implement Availability Zone independence"
weight : 30
---
In order to take better advantage of the fault isolation that AZs offer, we need to implement [Availability Zone independence (AZI)](https://docs.aws.amazon.com/whitepapers/latest/advanced-multi-az-resilience-patterns/availability-zone-independence.html) so that an impairment in one AZ doesn't cascade to other AZs. Here's the current architecture again. 

![wild-rydes-original-architecture](/static/wild-rydes-original-architecture.png)

You can see that in our APIs, the Application Load Balancer is using cross-zone load balancing. This means each load balancer node distributes traffic across the registered targets in all Availability Zones. When cross-zone load balancing is off, each load balancer node distributes traffic only across the registered targets in its Availability Zone. There are tradeoffs to consider when disabling cross-zone load balancing (described in [How Elastic Load Balancing works](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html)), but for our service, we're choosing to have cross-zone disabled. This helps prevent failures originating from targets say in AZ2 from being observed when the request is processed by the ALB node in AZ1. 

Additionally, you can see that the pods running on EKS can talk to pods in other AZs. We will also update the architecture to keep their traffic within the same AZ.

## See the impact of not using AZI
First, to demonstrate the benefit of AZI, we'll introduce a random fault to a particular AZ so you can see how the fault results in regional impact. Navigate to the [AWS Systems Manager Documents console](https://console.aws.amazon.com/systems-manager/documents).

::::alert{type="info" header="Check your AWS Region"}
The link may open the AWS SSM console in a different Region than the one you're running in the workshop, please validate you are in the correct Region.
::::

Select the *`Owned by me`* tab. From here, select the document with a name like *`multi-az-workshop-*-addLatency`* by clicking the link of the document's name. Next, click the *`Execute automation`* button at the top of the screen. This will open a new tab. At the bottom of this page, click *`Execute`*. This starts an AWS FIS experiment by randomly picking one of the AZs where it will inject latency to instances in that AZ when they communicate with the database. 

Wait for the SSM document execution's *`Overall status`* to be *`Success`*, this can take several minutes. 

![random-az-latency-ssm](/static/random-az-latency-ssm.png)

Then, navigate to the [AWS FIS experiments console](https://console.aws.amazon.com/fis/home#Experiments) and you should see one experiment currently running. Click on the experiment id, then the *`Targets`* tab.

![fis-az-target](/static/fis-az-target.png)

In this experiment, you can see it's only targeting instances in `us-east-2a` using the *`Placement.AvailabilityZone`* filter (your random AZ may be different). Now let's go to our [dashboards](https://console.aws.amazon.com/cloudwatch/home#dashboards/) and see what is being impacted. Select the *`wildrydes-ride-availability-and-latency-<region>`* dashboard. We're picking this one in particular because we know this operation interacts with the Aurora database. Scroll down to the *Server-side Metrics* section. You can see here that there is latency impact in a single AZ, but it's also raising the overall p99 latency for the region.

::::alert{type="info" header="Dashboard refresh"}
You may need to press the refresh button on the dashboard and/or wait a few minutes for the metrics to appear

![dashboard-refresh](/static/dashboard-refresh.png)
::::

![server-side-single-az-high-latency](/static/server-side-single-az-high-latency.png)

From the server-side perspective, it looks like there's only impact in one AZ. Let's validate what customers of Wild Rydes are experiencing by scrolling down to the *Canary Metrics* section. 

![canary-single-az-high-latency](/static/canary-single-az-high-latency.png)

Our canaries, and hence our customers, are having a different experience than the server-side metrics are indicating. We can see that from the canary's perspective that there's regional impact; it appears that all three AZs are impacted. The way the canary is making this determination is by testing the DNS A record ELB provides for our ALB, e.g. `myalb-name-and-hash.elb.us-east-2.amazonaws.com` as well as the [zonal DNS names](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/network-load-balancers.html#dns-name) (although the link is for NLB documentation, the same DNS names exist for ALBs) like `us-east-2a.myalb-name-and-hash.elb.us-east-2.amazonaws.com`. So, in total, the canary is testing 4 endpoints for this application:

- `https://myalb-name-and-hash.elb.us-east-2.amazonaws.com/ride`
- `https://us-east-2a.myalb-name-and-hash.elb.us-east-2.amazonaws.com/ride`
- `https://us-east-2b.myalb-name-and-hash.elb.us-east-2.amazonaws.com/ride`
- `https://us-east-2c.myalb-name-and-hash.elb.us-east-2.amazonaws.com/ride`

For each of these endpoints, the canary is observing a spike in p99 latency, so although we've introduced the failure in a single AZ, it's being propagated to every AZ. So even if a customer's request lands on an ALB node in `us-east-2b`, it can still be routed to instances in `us-east-2a` where the impact is occuring.

::::alert{type="info" header="Transient latency spikes"}
Although the canary may see transient latency spikes at p99 before the experiment started, you can see on the Success Latency dashboard that after the experiment is started, all AZs and the regional endpoint consistently have elevated latency.
::::

The other thing to note is that from the ALB's perspective, all of its targets in the target groups are healthy. You can see this on the [EC2 Target Groups console](https://console.aws.amazon.com/ec2/home#TargetGroups). Select the target group using the *Instance* target type. The ALB is configured to send health checks to the `/health` route of the application. This API doesn't trigger communication with the database, it is a shallow health check. This is the concept of *differential observability* in practice. From the ALB's perspective, the application is healthy, but from the customer's perspective, there's broad impact to the *`Ride`* operation.

![alb-targets-healthy](/static/alb-targets-healthy.png)

As you can see, determining the scope of impact and identifying what is going wrong can be a complex challenge even with a relatively simple service with a small number of failure modes. To make our multi-AZ architecture more effective and this observability challenge easier, we want the scope of impact to be smaller than the whole Region when these types of events occur; to do so we'll implement AZI in the Wild Rydes application.

Please stop the running experiment by clicking *`Stop experiment`* in the AWS FIS console before moving on.

![stop-experiment](/static/stop-experiment.png)

## Implementing AZI for your ALB's target groups
In the Target Groups console you should have two target groups, one for the EC2 auto scaling group and one for your EKS cluster. Select the one that is named like "*`multi-front-`*" (this is the same one you were just looking at). Then click the *`Attributes`* tab. You can see that cross-zone load balancing is enabled for this target group.

![ec2-target-cross-zone-on](/static/ec2-target-cross-zone-on.png)

Click the *Edit* button, turn cross-zone load balancing off, and then click *Save changes* at the bottom of the screen.

![cross-zone-off](/static/cross-zone-off.png)

Do the same thing for the other target group whose name starts with "*`multi-EKSAp-`*". Once that is complete, you've disabled cross-zone load balancing for all of the target groups behind your ALB. This means requests received by an ALB node in one AZ will only send traffic to EC2 and EKS nodes in the same AZ. That's our first step in implementing AZI. If we were using VPC endpoints or other zonal services in our application, we'd want to be sure our compute resources and the code they are running were configured to use the resource in the same AZ that they are located in.

## Implementing AZI for Istio on EKS

One of the operations hosted as a pod on our EKS cluster, *`Signin`* interacts with another operation, *`Home`*, also hosted on the EKS cluster. This inter-operation communication doesn't traverse the ALB, so the traffic is managed by [Istio](https://istio.io/), a common Kubernetes open-source service mesh. We are using [topology aware routing](https://kubernetes.io/docs/concepts/services-networking/topology-aware-routing/) in our Kubernetes service by defining this annotation:

```yaml
service.kubernetes.io/topology-mode: auto
```

However, this only causes the default routing logic to prefer destinations in the same AZ, but doesn't enforce it. If there isn't an endpoint available in the same zone, it will route to other zones, which could cascade failure. In order to enforce AZI, we may want to override this behavior. To do so, we'll use a `DestinationRule` with Istio to achieve AZI within the EKS cluster. A [`DestinationRule`](https://istio.io/latest/docs/reference/config/networking/destination-rule/) supports defining how traffic is distributed from source to destination based on the applied labels of a service.

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: AZI
spec:
  host: multi-az-workshop-service
  trafficPolicy:
    loadBalancer:
      localityLbSetting:
        enabled: true
        distribute:
          - from: "us-east-1/us-east-1a/*"
            to:
              "us-east-1/us-east-1a/*": 100
          - from: "us-east-1/us-east-1b/*"
            to:
              "us-east-1/us-east-1b/*": 100
          - from: "us-east-1/us-east-1c/*"
            to:
              "us-east-1/us-east-1c/*": 100
          - from: "us-east-1/us-east-1d/*"
            to:
              "us-east-1/us-east-1d/*": 100
          - from: "us-east-1/us-east-1e/*"
            to:
              "us-east-1/us-east-1e/*": 100
          - from: "us-east-1/us-east-1f/*"
            to:
              "us-east-1/us-east-1f/*": 100
```

This relies on the Kubernetes topology labels that are automatically applied by the EKS service to identify source and destination localities.

Let's log in to one of our EKS worker nodes to make the update by navigating to the [EC2 console](https://console.aws.amazon.com/ec2/home#Instances). Right click on one of the nodes that **doesn't** have a name (those are our EKS worker nodes) and select *`Connect`*.

![ec2-ssm-connect](/static/ec2-ssm-connect.png)

If not directed to the *`Session Manager`* tab on the *`Connect to instance`* tab, select it, then press the *`Connect`* button on the bottom right. This will start an interactive CLI on the EC2 instance. The first thing we need to do is download the `kubectl` command line utility and configure it (remember to change `<region>` to the AWS Region you're running the workshop in).

```bash
BUCKET_PATH=$(aws ssm get-parameter --name BucketPath --query 'Parameter.Value' | tr -d '"')
aws s3 cp ${BUCKET_PATH}kubectl /tmp/kubectl
chmod +x /tmp/kubectl
CLUSTER=$(aws ssm get-parameter --name ClusterName --query 'Parameter.Value' | tr -d '"')
aws eks update-kubeconfig --name $CLUSTER --region <region>
```

Next, download the manifest we'll use to apply the change (or feel free to create it yourself).

```bash
aws s3 cp ${BUCKET_PATH}destination-rule.yaml /tmp/destination-rule.yaml
```

If you're running the workshop in a Region other than `us-east-1`, you'll need to update the destination rule routing policies with the region and AZ names for the Region. Open your favorite editor and change the rules. 

::::expand{header="For example using vi:" variant="container"}
```bash
vi /tmp/destination-rule.yaml
```

Press `i` to enter `insert` mode, update the rules, and then press `esc` and type `:wq` and press `enter` to exit. If you are running the workshop in `us-west-2` which has four AZs, your rule would look like the following:

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: azi
spec:
  host: multi-az-workshop-service
  trafficPolicy:
    loadBalancer:
      localityLbSetting:
        enabled: true
        distribute:
          - from: "us-west-2/us-west-2a/*"
            to:
              "us-west-2/us-west-2a/*": 100
          - from: "us-west-2/us-west-2b/*"
            to:
              "us-west-2/us-west-2b/*": 100
          - from: "us-west-2/us-west-2c/*"
            to:
              "us-west-2/us-west-2c/*": 100
          - from: "us-west-2/us-west-2d/*"
            to:
              "us-west-2/us-west-2d/*": 100
```
::::

Then we'll apply the manifest to create the destination rule for our service. 

```bash
/tmp/kubectl --namespace multi-az-workshop apply --filename /tmp/destination-rule.yaml
```

Now, your architecture looks like this and prevents traffic at the application tier from crossing Availability Zones. Although communicating with the database still requires cross-AZ traffic, these changes will help isolate the scope of impact when zonal impairments happen.

![wild-rydes-azi-architecture](/static/wild-rydes-azi-architecture.png)

::::expand{header="There are several options for implementing locality aware routing in Kubernetes." variant="container"}
1. [Topology Aware Hints (TAH)](https://kubernetes.io/docs/concepts/services-networking/topology-aware-routing/) - This setting is enabled in the Wild Rydes service and can keep traffic within a zone, but it has some caveats. First, if there are fewer than 3 endpoints per zone, there is a high (≈50%) probability that the EndpointSlice controller will not be able to allocate endpoints evenly and instead will fall back to the default cluster-wide routing approach. Second, the kube-proxy component filters the endpoints it routes to based on the hints set by the EndpointSlice controller. In most cases, this means that the kube-proxy is able to route traffic to endpoints in the same zone. Sometimes the controller allocates endpoints from a different zone to ensure more even distribution of endpoints between zones. This would result in some traffic being routed to other zones. Because of these two reasons, TAH is not sufficient for enforcing AZI.

2. [Istio Locality Load Balancing](https://istio.io/latest/docs/tasks/traffic-management/locality-load-balancing/) - Locality load balancing provides [three options](https://istio.io/latest/docs/reference/config/networking/destination-rule/#LocalityLoadBalancerSetting) for specifying how traffic is routed in a `DestinationRule` or as part of the Global Mesh Config. The first is `failoverPriority`. This allows you to prioritize what endpoints are used, but it doesn't enforce only using endpoints in the same zone. The next option is `failover`. Zone and sub-zone failover is supported by default, so this only needs to be specified for regions when the operator needs to constrain traffic failover. While same zone routing is preferred using this option, it is not enforced. The third option is `distribute`. This is the option we chose to use because we can specify 100% of the traffic is only routed to the same zone, and if no endpoints are available, the requests fail. For AZI to be effective, we actually want all of the resources in a single AZ to fail together. However, you should consider your own use cases, pod distribution, and desired failure modes.
::::

One other important consideration is to make sure that we have pods in each AZ so that requests can be handled in the same AZ that the load balancer receives them. To do that, we use [`topologySpreadConstraints`](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/) in our deployment definition. 

```yaml
apiVersion: app/v1
kind: Deployment
spec:
  template:
    topologySpreadConstraints:
      - topologyKey: topology.kubernetes.io/zone
        maxSkew: 1
        labelSelector:
          matchLabels:
            app: my-app
        whenUnsatisfiable: ScheduleAnyway
```
The `maxSkew` describes the degree to which Pods may be unevenly distributed. In this case we want to make sure there isn't a skew of more than 1 Pod across the available AZs, which should help us try and keep 2 Pods in each AZ, but it could lead to slight imbalances depending on the number of Pods you are running. Like we mentioned in the previous lab, this imbalance combined with cross-zone load balancing enabled could cause unintentional skews in the amount of traffic being handled in each AZ and may not make single-AZ impairments detectable.

## Conclusion

In this lab you saw the regional impact from not using AZI when the failure was contained within a single AZ. Then, you updated your ALB target groups to disable cross-zone load balancing. After that, you created an Istio `DestinationRule` to enforce AZI traffic routing for the Kubernetes pods in our service. In the next lab we're going to simulate a random failure and see how this improved architecture responds.
