---
title : "ラボ2: アベイラビリティゾーン独立性の実装"
weight : 30
---
AZが提供する障害分離をより効果的に活用するために、[アベイラビリティゾーン独立性 Availability Zone independence(AZI)](https://docs.aws.amazon.com/whitepapers/latest/advanced-multi-az-resilience-patterns/availability-zone-independence.html)を実装し、1つのAZの障害が他のAZに波及しないようにする必要があります。現在のアーキテクチャを再度確認してみましょう。

![wild-rydes-original-architecture](/static/wild-rydes-original-architecture.png)

APIの経路として、Application Load Balancerがクロスゾーンロードバランシングを使用していることがわかります。これは、各ロードバランサーノードが、登録されたすべてのアベイラビリティゾーンのターゲットにトラフィックを分散することを意味します。クロスゾーン負荷分散がオフの場合、各ロードバランサーノードは、そのアベイラビリティゾーン内の登録されたターゲットにのみトラフィックを分散します。クロスゾーン負荷分散を無効にする際には考慮すべきトレードオフがありますが（[Elastic Load Balancingの仕組み](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html)に説明があります）、私たちのサービスでは、AZIが提供する小さく予測可能な影響範囲を選択します。

さらに、EKS上で実行されているポッドが他のAZのポッドと通信できることがわかります。アーキテクチャを更新して、トラフィックを同じAZ内に留めます。

## AZIを使用しない場合の影響を確認
まず、AZIの利点を示すために、ランダムに選択されたAZに障害を注入し、その障害がリージョン全体に影響を与える様子を確認します。具体的には、AZ内のインスタンスに対し、DBとの通信レイテンシーが増加する障害を注入します。[AWS Systems Manager Documentsコンソール](https://console.aws.amazon.com/systems-manager/documents)に移動してください。

::::alert{type="info" header="AWSリージョンの確認"}
リンクをクリックすると、ワークショップで使用しているリージョンとは異なるリージョンのAWS SSMコンソールが開く場合があります。正しいリージョンにいることを確認してください。
::::

*`Owned by me(自己所有)`* タブを選択します。ここから、*`multi-az-workshop-*-addLatency`* のような名前のドキュメントをクリックして選択します。次に、画面上部の *`Execute automation(オートメーションを実行する)`* ボタンをクリックします。新しいタブが開きます。このページの下部で *`Execute`* をクリックします。これにより、ランダムに選択された1つのAZにおいて、AZ内のインスタンスがデータベースと通信する際にレイテンシーを注入するFIS実験が開始されます。

Overall status が Success となるまで待ちます。これには数分かかる場合があります。

![random-az-latency-ssm](/static/random-az-latency-ssm.png)

[AWS FIS 実験コンソール](https://console.aws.amazon.com/fis/home#Experiments)に移動すると、現在実行中の実験が表示されます。実験IDをクリックし、*`Targets(ターゲット)`* タブをクリックします。

![fis-az-target](/static/fis-az-target.png)

この実験(図の例)では、*`Placement.AvailabilityZone`* フィルターを使用して`us-east-1a`のインスタンスのみをターゲットにしていることがわかります。[CloudWatch Dashboardsコンソール](https://console.aws.amazon.com/cloudwatch/home#dashboards/)に移動して、影響を確認しましょう。*`wildrydes-ride-operation-availability-and-latency-<region>`* ダッシュボードを選択します。この操作(Rideのリクエスト)は、Auroraデータベースと通信することがわかっているため、このダッシュボードを選択しています。*Server-side Latency*セクションまでスクロールすると、単一のAZでレイテンシーの影響が発生していますが、リージョン全体のp99レイテンシーも上昇していることがわかります。

![server-side-single-az-high-latency](/static/server-side-single-az-high-latency.png)

Wild Rydesの顧客が経験している影響を確認するために、*Canary Measured Latency*セクションまでスクロールしてみましょう。

![canary-single-az-high-latency](/static/canary-single-az-high-latency.png)

このグラフは、合成カナリアから測定されたレイテンシーを示しています。リージョンのレイテンシー測定はALBのリージョンエンドポイントをターゲットとし、各ゾーンのレイテンシーチャートはALBの[ゾーンDNS名](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/network-load-balancers.html#dns-name)（このリンクはNLBのドキュメントですが、ALBでも同じDNS名が存在します）を使用したリクエストから導出されています（例：`us-east-1a.myalb.elb.amazonaws.com`）。どちらの場合も、顧客の視点から見ると影響はリージョン全体に及んでいることがわかります。障害が単一のAZのインスタンスにのみ適用されているにもかかわらず、顧客がどのAZと対話しても影響を受けます。リクエストが`us-east-1b`のALBノードに送信された場合でも、影響が発生している`us-east-1c`のEC2インスタンスにルーティングされる可能性があります。

また注目すべき点として、ALBの観点からは、ターゲットグループ内のすべてのターゲットが正常であることが挙げられます。これは[EC2 Target Groupコンソール](https://console.aws.amazon.com/ec2/home#TargetGroups)で確認できます。ALBはサービスの`/health`ルートをターゲットとするように設定されています。このAPIはデータベースとの通信をトリガーせず、浅いヘルスチェックです。これは *視点別の可観測性(オブザーバビリティ)* の概念の実践例です。ALBの観点からはサービスは正常ですが、顧客の観点からは *`Ride`* オペレーションに広範な影響があります。

![alb-targets-healthy](/static/alb-targets-healthy.png)

このように、比較的シンプルなサービスで障害モードの数が少ない場合でも、影響の範囲を特定し、何が問題なのかを識別することは複雑な課題となります。マルチAZアーキテクチャをより効果的にし、この観測性の課題を容易にするために、このような種類のイベントが発生した場合の影響範囲をリージョン全体よりも小さくしたいと考えています。そのために、サービスにAZIを実装します。

::::alert{type="info" header="実験終了"}
この時点で、AWS FIS 実験がまだ自動的に終了していない場合は、先に進む前に終了してください。AWS FIS コンソールで　*`Stop experiment(実験を停止)`* をクリックして停止できます。
![stop-experiment](/static/stop-experiment.png)
::::

## ALBのターゲットグループに対するAZIの実装
次に、[Target Groupsコンソール](https://console.aws.amazon.com/ec2/home#TargetGroups)に移動します。EC2オートスケーリンググループ用とEKSクラスター用の2つのターゲットグループがあるはずです。"*`multi-front-`*"のような名前のものを選択します。次に *`Attributes(属性)`* タブをクリックします。このターゲットグループでクロスゾーン負荷分散が有効になっていることがわかります。

![ec2-target-cross-zone-on](/static/ec2-target-cross-zone-on.png)

*編集*ボタンをクリックし、クロスゾーン負荷分散をオフにして、画面下部の*変更内容の保存*をクリックします。

![cross-zone-off](/static/cross-zone-off.png)

ターゲットグループに表示されているすべてのグループに対して同じ操作を行います。これが完了すると、ALBの背後にあるすべてのターゲットグループでクロスゾーン負荷分散が無効になります。これにより、1つのAZのALBノードが受け取ったリクエストは、同じAZ内のEC2およびEKSノードにのみトラフィックを送信するようになります。これがAZI実装の最初のステップです！VPCエンドポイントやその他のゾーンサービスを使用している場合は、コンピューティングリソースとそれらが実行しているコードが、配置されているのと同じAZ内のリソースを使用するように構成されていることを確認する必要があります。

## Implementing AZI for Istio on EKS

EKSクラスター上でポッドとしてホストされている操作の1つである *`Signin`* は、同じくEKSクラスター上でホストされている別の操作 *`Home`* と対話します。この操作間通信はALBを通過しないため、トラフィックは一般的なKubernetesオープンソースサービスメッシュである[Istio](https://istio.io/)によって管理されています。Kubernetesサービスでは、以下のアノテーションを定義することで[トポロジー対応ルーティング](https://kubernetes.io/docs/concepts/services-networking/topology-aware-routing/)を使用しています。

```yaml
service.kubernetes.io/topology-mode: auto
```

しかし、これはデフォルトのルーティングロジックが同じAZ内の宛先を優先するだけで、強制はしません。同じゾーンで利用可能なエンドポイントがない場合、他のゾーンにルーティングされ、障害が連鎖する可能性があります。AZIを強制するために、実際にはこの動作をオーバーライドする必要があります。そのために、EKSクラスター内でAZIを実現するためにIstioの`DestinationRule`を使用します。[`DestinationRule`](https://istio.io/latest/docs/reference/config/networking/destination-rule/)は、サービスに適用されたラベルに基づいて、送信元から宛先へのトラフィックの分散方法を定義することをサポートしています。

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

これは、送信元と宛先のロカリティを識別するために、EKSサービスによって自動的に適用されるKubernetesトポロジーラベルに依存しています。

更新を行うために、[EC2コンソール](https://console.aws.amazon.com/ec2/home#Instances)に移動して、EKSワーカーノードの1つにログインしましょう。名前が**ない**ノードの1つ（これらが私たちのEKSワーカーノードです）を右クリックし、*`Connect(接続)`* を選択します。

![ec2-ssm-connect](/static/ec2-ssm-connect.png)

*`Connect to instance(インスタンスに接続)`* 画面の *`Session Manager(セッションマネージャー)`* タブに移動していない場合は、それを選択し、右下の *`Connect（接続）`* ボタンを押します。これにより、EC2インスタンス上でインタラクティブなCLIが開始されます。最初に行う必要があるのは、`kubectl`コマンドラインユーティリティをダウンロードして設定することです（\<region\>をワークショップを実行しているAWSリージョンに変更することを忘れないでください）。


```bash
BUCKET_PATH=$(aws ssm get-parameter --name BucketPath --query 'Parameter.Value' | tr -d '"')
aws s3 cp ${BUCKET_PATH}helm/kubectl /tmp/kubectl
chmod +x /tmp/kubectl
CLUSTER=$(aws ssm get-parameter --name ClusterName --query 'Parameter.Value' | tr -d '"')
aws eks update-kubeconfig --name $CLUSTER --region <region>
```

次に、変更を適用するために使用するマニフェストをダウンロードします（または自分で作成しても構いません）。

```bash
aws s3 cp ${BUCKET_PATH}helm/destination-rule.yaml /tmp/destination-rule.yaml
```

`us-east-1`以外のリージョンでワークショップを実行している場合は、そのリージョンのリージョン名とAZ名を使用してデスティネーションルールのルーティングポリシーを更新する必要があります。お好みのエディタを開いてルールを変更してください。

::::expand{header="例えばviを使用する場合:" variant="container"}
```bash
vi /tmp/destination-rule.yaml
```

`i`を押して`insert`モードに入り、ルールを更新し、その後`esc`を押して`:wq`と入力し、`enter`を押して終了します。4つのAZを持つ`us-west-2`でワークショップを実行している場合、ルールは以下のようになります：

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

その後、マニフェストを適用して、サービスのデスティネーションルールを作成します。

```bash
/tmp/kubectl --namespace multi-az-workshop apply --filename /tmp/destination-rule.yaml
```

これで、アーキテクチャは以下のようになり、アプリケーション層でのトラフィックがアベイラビリティゾーンを跨ぐことを防ぎます。データベースとの通信は依然としてクロスAZトラフィックを必要としますが、これらの変更により、ゾーンの障害が発生した場合の影響範囲を局所化するのに役立ちます。

![wild-rydes-azi-architecture](/static/wild-rydes-azi-architecture.png)

::::expand{header="Kubernetesでロカリティ対応ルーティングを実装するための複数のオプションがあります。" variant="container"}
1. [Topology Aware Hints (TAH)](https://kubernetes.io/docs/concepts/services-networking/topology-aware-routing/) - この設定はWild Rydesサービスで有効化されており、ゾーン内でトラフィックを保持できますが、いくつかの注意点があります。まず、ゾーンごとのエンドポイントが3つ未満の場合、EndpointSliceコントローラーがエンドポイントを均等に割り当てられない可能性が高く（約50%）、代わりにデフォルトのクラスター全体のルーティングアプローチにフォールバックします。次に、kube-proxyコンポーネントは、EndpointSliceコントローラーによって設定されたヒントに基づいてルーティング先のエンドポイントをフィルタリングします。ほとんどの場合、これはkube-proxyが同じゾーン内のエンドポイントにトラフィックをルーティングできることを意味します。時にはコントローラーがゾーン間のエンドポイントの分散をより均等にするために、異なるゾーンからエンドポイントを割り当てることがあります。これにより、一部のトラフィックが他のゾーンにルーティングされることになります。これらの2つの理由により、TAHはAZIを強制するには十分ではありません。

2. [Istio Locality Load Balancing](https://istio.io/latest/docs/tasks/traffic-management/locality-load-balancing/) - ロカリティロードバランシングは、`DestinationRule`またはグローバルメッシュ設定の一部としてトラフィックをルーティングする方法を指定するための[3つのオプション](https://istio.io/latest/docs/reference/config/networking/destination-rule/#LocalityLoadBalancerSetting)を提供します。1つ目は`failoverPriority`です。これにより使用するエンドポイントの優先順位を設定できますが、同じゾーン内のエンドポイントのみの使用を強制はしません。次のオプションは`failover`です。ゾーンとサブゾーンのフェイルオーバーはデフォルトでサポートされているため、オペレーターがトラフィックのフェイルオーバーを制限する必要がある場合にのみリージョンに対して指定する必要があります。このオプションを使用すると同じゾーンルーティングが優先されますが、強制はされません。3つ目のオプションは`distribute`です。これは私たちが選択したオプションで、トラフィックの100%が同じゾーンにのみルーティングされ、利用可能なエンドポイントがない場合はリクエストが失敗するように指定できます。AZIを効果的にするためには、実際には単一のAZ内のすべてのリソースが一緒に失敗することを望んでいます。ただし、独自のユースケース、ポッドの分散、および望ましい障害モードを考慮する必要があります。
::::

## まとめ

このラボでは、障害が単一のAZ内に封じ込められている場合でも、AZIを使用しないことによるリージョン全体への影響を確認しました。その後、ALBターゲットグループを更新してクロスゾーン負荷分散を無効にしました。さらに、Istioの`DestinationRule`を作成して、サービス内のKubernetesポッドに対してAZIトラフィックルーティングを強制しました。次のラボでは、ランダムな障害をシミュレートして、この改善されたアーキテクチャがどのように応答するかを確認します。
