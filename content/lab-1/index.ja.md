---
title : "ラボ1: 運用ダッシュボードの確認"
weight : 20
---

Wild Rydesワークショップサービスへようこそ。Wild Rydesは、ユニコーンのライドを依頼、監視、支払いできるサービスです。

![wild-rydes](/static/wild-rydes.png)

このサービスは、以前の[サーバーレスAPIワークショップ](https://aws.amazon.com/getting-started/hands-on/build-serverless-web-app-lambda-apigateway-s3-dynamodb-cognito/)で使用したことがあるかもしれません。このワークショップでは、AWS アベイラビリティーゾーン (AZ) を使用して回復力を高める方法を説明します。Wild Rydes がサーバーレスになる前、このサービスは Amazon Aurora データベースを使用した完全に Amazon EC2 ベースのモノリシックアプリケーションとして開始されました。時間の経過とともに、このサービスのモダナイゼーションが始まり[ストラングラーパターン](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html)を使用していくつかの API が EKS に移行されました。つまり、一部の API はまだ EC2 で実行され、他の API は EKS で実行されています。サービスの現在のアーキテクチャを確認しましょう。

![wild-rydes-original-architecture](/static/wild-rydes-original-architecture.png)

このラボでは、Wild Rydesサービスによって生成される運用メトリクスを確認します。まず、[Amazon CloudWatchコンソール](https://console.aws.amazon.com/cloudwatch/home)に移動します。

左側のナビゲーションから[ダッシュボード](https://console.aws.amazon.com/cloudwatch/home?#dashboards:)を選択します。そこには、Wild Rydesサービスの各機能(Home、Signin、Pay、Ride)用のダッシュボードと、サービス全体の集計ダッシュボードの5つが表示されているはずです。

![dashboards](/static/dashboards.png)

まず、サービス全体のダッシュボード *`wildrydes-service-availability-and-latency-<region>`* をクリックしてみましょう。

::::alert{type="info" header="リージョンの選択"}
このワークショップでは、`<region>`はワークショップを実行しているAWSリージョンのプレースホルダーとして使用しています。`<az>`も同様に、影響が発生したAZ (Availability Zone)を表します。リソース名は実際のリージョンやAZに応じて確認してください。
::::

::::alert{type="info" header="メトリクスの反映"}
CloudFormationテンプレートの展開直後は、ダッシュボードにメトリクスデータが反映されるまで10~15分ほど待つ必要があります。
::::

## サービスの可用性とレイテンシーダッシュボード
このダッシュボードでは、サービスを構成するすべての重要な操作の集計ビューを提供します。上部にはサービスのリージョンアラームがあります。これは、すべてのアベイラビリティゾーンにおけるサーバーサイドの障害の総数をカウントするように構成されています。障害の総数が閾値を超えると、このアラームが発生します。アラームは単にリージョンのどこかに問題があることを示すだけで、それが単一のAZに限定されているかどうかは示しません。その下には、すべての重要な操作にわたる、AZの影響を個別に示す複合アラームがあります。これらのアラームは、1つ以上の重要な操作が単一のAZで影響を受けた場合に発生します。例えば、`Signin`操作が`us-east-1a`で影響を受け、`Ride`操作が`us-east-1b`で影響を受けるといった状況が考えられます。そのため、これらのうち2つ以上が同時にアラーム状態になる可能性があります。もしそうなった場合、それは影響がゾーン単位ではなく、リージョン単位であることを示しています。

::::alert{type="info" header="リージョン"}
ワークショップ用のAWSコンソールと新しいタブを開く際は、リソースが見つからないまたは権限エラーが発生する場合、正しいリージョンにいることを確認してください。
::::

![service-top-level-alarms](/static/service-top-level-alarms.png)

アラームの後には、さまざまなメトリクスのグラフが表示されます。次のグラフは、障害数に対するAZの関与度を示しています。これは、各AZが全重要操作にわたって生成している障害の総数を理解するのに役立ちます。

![service-az-fault-contributors](/static/service-az-fault-contributors.png)

::::alert{type="info" header="ダッシュボード"}
あなたのダッシュボードは、ここに示されているものと完全に同じように見えない場合があります。それは問題ありません。一部は、ダッシュボードが提供する情報を代表するために、障害やレイテンシーが存在する状態で表示されています。また、エラーや高レイテンシーのレスポンスが発生した場所で一時的な「ブリップ(急上昇)」が表示される場合があります。
::::

次に、サーバー側と[合成カナリヤ](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html)の両方で測定された可用性のグラフが表示されます。合成カナリアは顧客と同じアクションを実行するため、顧客エクスペリエンスを継続的に検証し、顧客よりも先に問題を発見することが可能になります。

![service-server-availability-graphs](/static/service-server-availability-graphs.png)

![service-canary-availability-graphs](/static/service-canary-availability-graphs.png)

最後に、同じくサーバー側と合成カナリアで測定されたレイテンシーのグラフが表示されます。各操作には異なるレイテンシーの閾値があるため、これらのグラフはリクエストに対する成功したが高レイテンシーのレスポンスの数を測定しています。

![service-latency-graphs](/static/service-latency-graphs.png)

これらのアラームとウィジェットは、問題が発生した際のトリアージとトラブルシューティングのプロセスを簡素化するのに役立ちます。どの操作が影響を受けているか、そしてどこで影響が出ているかを特定するのに役立ちます。それにより、何が起きているかについてより詳しく知るために、特定の操作のダッシュボードを確認することにつながるかもしれません。ダッシュボードのホームページに戻って、`Ride`操作の操作ダッシュボード *`wildrydes-ride-operation-availability-and-latency-<region>`* を見てみましょう。

## オペレーション別ダッシュボード
サービス内の各オペレーションには、それぞれ専用のダッシュボードがあります。これらは、サーバーサイドとカナリアの両方から測定された、オペレーションごとの可用性とレイテンシーに関する詳細情報を提供します。レイアウトはサービスレベルのダッシュボードと似ています。上部にはリージョンとゾーンのアラームがあり、その後に障害とレイテンシーの要因を示すグラフ、サーバーサイドとカナリアで測定された可用性とレイテンシーのメトリクス、さらにサービスで使用されているALBの運用メトリクスが続きます。

### オペレーションアラーム
ダッシュボードの上段（Top Level Aggregate Alarms)にある、リージョンアラーム(Regional Impact)は、そのリージョンで問題が発生していることを示しますが、必ずしも複数のAZにまたがっているわけではありません。その下にあるゾーン単位の影響アラーム(Isolated Impact)は、アベイラビリティゾーンで個別の影響が発生していることを示します。

![ride-dashboard-agg-alarms](/static/ride-dashboard-agg-alarms.png)

ウィジェット(Isolated Impactの緑色アイコン)をクリックすると、ポップアップが表示されます。ポップアップの下部にある *View details page(詳細ページを表示)* を選択して（新しいタブで開くことをお勧めします）、ゾーン単位の影響アラームの1つを見てみましょう。

この影響アラームは、サーバー側とカナリアの2つの子アラームを持つCloudWatch複合アラームであることがわかります。これは、どちらかの視点から個別の影響が見られた場合に、このアラームが発生することを意味します。

![operation-isolated-impact-alarm](/static/operation-isolated-impact-alarm.png)

それらの子アラームの1つ、例えば *`-server`* アラームをさらに詳しく見ると、これもCloudWatch複合アラームですが、今度は6つの他のアラームで構成されていることがわかります。

![operation-server-isolated-impact-alarm](/static/operation-server-isolated-impact-alarm.png)

*Alarm rule*を表示すると、このアラームがどのように構成されているかを確認できます。

```
(
    (
        ALARM("arn:aws:cloudwatch:us-east-1:123456789012:alarm:use1-az2-ride-chi-squared-majority-errors-impact-server") AND ALARM("arn:aws:cloudwatch:us-east-1:123456789012:alarm:use1-az2-ride-success-rate-server") AND ALARM("arn:aws:cloudwatch:us-east-1:123456789012:alarm:use1-az2-ride-multiple-instances-faults-server")
    ) 
OR 
    (
        ALARM("arn:aws:cloudwatch:us-east-1:123456789012:alarm:use1-az2-ride-chi-squared-majority-high-latency-impact-server") AND ALARM("arn:aws:cloudwatch:us-east-1:123456789012:alarm:use1-az2-ride-success-latency-server") AND ALARM("arn:aws:cloudwatch:us-east-1:123456789012:alarm:use1-az2-ride-multiple-instances-high-latency-server")
    )
)
```

AZに個別の影響がある（つまり、そのオペレーションについて、他のAZはこれほどの影響を受けていない）と判断するためには、可用性またはレイテンシーの影響について、以下の3つの条件が満たされる必要があります：

1. 影響が閾値を超えていること。例えば、可用性が99.9%を下回る、またはレイテンシーが200msを超えるなど。
2. 複数のインスタンスが影響を引き起こしていること。これにより、1つの不良インスタンスだけでAZ全体が損なわれているように見えることを防ぎます。
3. エラーまたは高レイテンシーレスポンスの量が、他のAZと比較して外れ値となっていること。これを判断するためにはいくつかの異なる統計テスト（例：カイ二乗検定やZスコア）を使用できますが、このワークショップでは静的な指標として70%を使用しています。つまり、AZがエラーの70%を占める場合に外れ値とみなされます。これは非常に信頼性の高い方法です。

### オペレーションメトリクス
ダッシュボードの残りの部分には、可用性とレイテンシーメトリクスのグラフウィジェットと関連するアラームが含まれています。これらを使用して、マルチAZレジリエンスパターンを用いて軽減できるゾーン単位の影響があるかどうかを判断します。ダッシュボードとアラームを自由に探索して、これらのメトリクスがどのように生成されているかを確認してください。

## カナリアと監視の自動化に関する追加情報（任意の読み物）
以下のセクションでは、合成カナリアと、[Cloud Development Kit (CDK)](https://aws.amazon.com/cdk/)を使用した自動化によってこの監視がどのように構築されたかについての追加詳細を提供します。

### カナリア
カナリアがどのように設定されているかを確認したい場合は、[AWS Lambdaコンソール](https://console.aws.amazon.com/lambda/home#/functions)にアクセスできます。 *`multi-az-workshop-MultiAZ-CanaryFunctioncanary...`* に類似した名前の関数を探してください。コードパッケージはコンソールで確認が可能です。また、下記手順にてダウンロードし確認が可能です。（ワークショップの環境によっては、ダウンロードできない場合があります。）

::::expand{header="カナリアのソースコードをダウンロードする手順" variant="container"}
[CloudFormationコンソール](https://console.aws.amazon.com/cloudformation/home#/stacks?filteringText=&filteringStatus=active&viewNested=true)に移動し、*`multi-az-workshop-MultiAZObservabilityStack-MultiAZObservabilityCanaryNestedStackCanar-...`* のような名前のスタックをクリックします。上部の *`Template`* タブをクリックして、Lambda関数のデプロイに使用されたCloudFormationテンプレートを確認します。`AWS::Lambda::Function`リソースが表示されるまでスクロールしてください。

![lambda-function-template](/static/lambda-function-template.png)

`${AssetsBucketPrefix}`の後に続くzipファイルの名前をコピーします。この[リンク](:assetUrl{path=/ source=s3})と組み合わせてください（右クリックしてリンクをコピー）。以下のようなURLになるはずです。
```bash
https://static.us-east-1.prod.workshops.aws/public/e700b077-7827-4455-a820-f4d545aa2712/assets/53099e290b0e54b00026ca7fa3c848a2ac701e1db20b01b5b4fec5bd1ce60a58.zip
```

メインのコードは`index.py`ファイルにあります。
::::

Lambda関数は複数の異なるEventBridgeイベントによってトリガーされていることがわかります。強調表示されたボックスをクリックすると、すべてのイベントを確認できます。

![lambda-triggers](/static/lambda-triggers.png)

イベントの1つをクリックしてその定義を確認してください。新しいタブが開いたら、*`Targets(ターゲット)`* タブをクリックし、*`Input to target:（ターゲットへの入力）`* の横にある *`View（表示）`* をクリックします。

![target-input](/static/target-input.png)

以下のような入力が表示されます：

```json
{
  "parameters": {
    "methods": ["GET"],
    "url": "http://us-east-1a.internal-multi--ALBAE-ypBbnB8gs0tP-1311357276.us-east-1.elb.amazonaws.com/home",
    "postData": "",
    "headers": {},
    "operation": "Home",
    "faultBoundaryId": "use1-az2",
    "faultBoundary": "az",
    "metricNamespace": "canary/metrics",
    "requestCount": 60
  }
}
```

このイベントは1分ごとに実行されるようにスケジュールされています。イベントで指定されたURLに60回のHTTPリクエストを発行します。その他のデータは、どのAZをテストしているか、どの操作をテストしているか、メトリクスをどのメトリクス名前空間に生成すべきかなど、関数がメトリクスをどのように記録するかを指示します。関数が生成している[CloudWatch Logs](https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups)を確認してみましょう。 *`/aws/lambda/multi-az-workshop-MultiAZ-CanaryFunctioncanary...`* のような名前のロググループを探してください（最初のページにない場合があります）。ロググループをクリックし、利用可能なログストリームのいずれかをクリックします。以下のような多数のエントリが見つかるはずです。

![canary-log](/static/canary-log.png)

カナリアは[Embedded Metric Format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html)（EMF）を使用してメトリクスを記録しています。EMFは、構造化されたログを生成すると同時に、それらのログからカスタムCloudWatchメトリクスを抽出するための統一されたアプローチを提供します。これにより、埋め込まれたメトリクスデータに基づいてCloudWatchダッシュボードやアラームを作成し、Contributor Insightsなどのツールでログをクエリすることが、単一のソリューションで可能になります。サーバーサイドでも同様のログが生成される様子は、ラボ3で確認できます。

### 可観測性の簡素化
アラーム、メトリクス、ダッシュボードの設定と構築が少し複雑に感じられるのは、実際にそうだからです。単一AZの影響に関するシグナルを提供するために、考慮して組み合わせる必要のある情報が多くあります。セットアップを簡素化し、適切なデフォルト値を使用するために、このワークショップでは、必要な監視を簡単に設定できるオープンソースのCDKコンストラクト（TypeScript、Go、Python、.NETで利用可能[Javaは近日公開予定]）を使用しています。CDKコンストラクトを使用するには、以下のようにサービスを定義します：

```csharp
var wildRydesService = new Service(new ServiceProps(){
    ServiceName = "WildRydes",
    BaseUrl = "http://www.example.com",
    FaultCountThreshold = 25,
    AvailabilityZoneNames = vpc.AvailabilityZones,
    Period = Duration.Seconds(60),
    LoadBalancer = loadBalancer,
    DefaultAvailabilityMetricDetails = new ServiceMetricDetails(new ServiceMetricDetailsProps() {
        AlarmStatistic = "Sum",
        DatapointsToAlarm = 3,
        EvaluationPeriods = 5,
        FaultAlarmThreshold = 1,
        FaultMetricNames = new string[] { "Fault", "Error" },
        GraphedFaultStatistics = new string[] { "Sum" },
        GraphedSuccessStatistics = new string[] { "Sum" },
        MetricNamespace = metricsNamespace,
        Period = Duration.Seconds(60),
        SuccessAlarmThreshold = 99,
        SuccessMetricNames = new string[] {"Success"},
        Unit = Unit.COUNT,
    }),
    DefaultLatencyMetricDetails = new ServiceMetricDetails(new ServiceMetricDetailsProps(){
        AlarmStatistic = "p99",
        DatapointsToAlarm = 3,
        EvaluationPeriods = 5,
        FaultAlarmThreshold = 1,
        FaultMetricNames = new string[] { "FaultLatency" },
        GraphedFaultStatistics = new string[] { "p50" },
        GraphedSuccessStatistics = new string[] { "p50", "p99", "tm50", "tm99" },
        MetricNamespace = metricsNamespace,
        Period = Duration.Seconds(60),
        SuccessAlarmThreshold = 100,
        SuccessMetricNames = new string[] {"SuccessLatency"},
        Unit = Unit.MILLISECONDS,
    }),
    DefaultContributorInsightRuleDetails =  new ContributorInsightRuleDetails(new ContributorInsightRuleDetailsProps() {
        AvailabilityZoneIdJsonPath = azIdJsonPath,
        FaultMetricJsonPath = faultMetricJsonPath,
        InstanceIdJsonPath = instanceIdJsonPath,
        LogGroups = serverLogGroups,
        OperationNameJsonPath = operationNameJsonPath,
        SuccessLatencyMetricJsonPath = successLatencyMetricJsonPath
    }),
    CanaryTestProps = new AddCanaryTestProps() {
        RequestCount = 10,
        LoadBalancer = loadBalancer,
        Schedule = "rate(1 minute)",
        NetworkConfiguration = new NetworkConfigurationProps() {
            Vpc = vpc,
            SubnetSelection = new SubnetSelection() { SubnetType = SubnetType.PRIVATE_ISOLATED }
        }
    }
});
wildRydesService.AddOperation(new Operation(new OperationProps() {
    OperationName = "Signin",
    Path = "/signin",
    Service = wildRydesService,
    Critical = true,
    HttpMethods = new string[] { "GET" },
    ServerSideAvailabilityMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Signin",
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Signin"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultAvailabilityMetricDetails),
    ServerSideLatencyMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Signin",
        SuccessAlarmThreshold = 150,
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Signin"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultLatencyMetricDetails),
    CanaryTestLatencyMetricsOverride = new CanaryTestMetricsOverride(new CanaryTestMetricsOverrideProps() {
        SuccessAlarmThreshold = 250
    })
}));
wildRydesService.AddOperation(new Operation(new OperationProps() {
    OperationName = "Pay",
    Path = "/pay",
    Service = wildRydesService,
    HttpMethods = new string[] { "GET" },
    Critical = true,
    ServerSideAvailabilityMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Pay",
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Pay"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultAvailabilityMetricDetails),
    ServerSideLatencyMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Pay",
        SuccessAlarmThreshold = 200,
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Pay"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultLatencyMetricDetails),
    CanaryTestLatencyMetricsOverride = new CanaryTestMetricsOverride(new CanaryTestMetricsOverrideProps() {
        SuccessAlarmThreshold = 300
    })
}));
wildRydesService.AddOperation(new Operation(new OperationProps() {
    OperationName = "Ride",
    Path = "/ride",
    Service = wildRydesService,
    HttpMethods = new string[] { "GET" },
    Critical = true,
    ServerSideAvailabilityMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Ride",
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Ride"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultAvailabilityMetricDetails),
    ServerSideLatencyMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Ride",
        SuccessAlarmThreshold = 350,
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Ride"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultLatencyMetricDetails),
    CanaryTestLatencyMetricsOverride = new CanaryTestMetricsOverride(new CanaryTestMetricsOverrideProps() {
        SuccessAlarmThreshold = 550
    })
}));
wildRydesService.AddOperation(new Operation(new OperationProps() {
    OperationName = "Home",
    Path = "/home",
    Service = wildRydesService,
    HttpMethods = new string[] { "GET" },
    Critical = true,
    ServerSideAvailabilityMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Home",
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Ride"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultAvailabilityMetricDetails),
    ServerSideLatencyMetricDetails = new OperationMetricDetails(new OperationMetricDetailsProps() {
        OperationName = "Home",
        SuccessAlarmThreshold = 100,
        MetricDimensions = new MetricDimensions(new Dictionary<string, string> {{ "Operation", "Ride"}}, "AZ-ID", "Region")
    }, wildRydesService.DefaultLatencyMetricDetails),
    CanaryTestLatencyMetricsOverride = new CanaryTestMetricsOverride(new CanaryTestMetricsOverrideProps() {
        SuccessAlarmThreshold = 200
    })
}));
```

次に、そのサービス定義を CDK コンストラクトに提供します。

```csharp
InstrumentedServiceMultiAZObservability multiAvailabilityZoneObservability = new InstrumentedServiceMultiAZObservability(this, "MultiAZObservability", new InstrumentedServiceMultiAZObservabilityProps() {
    Service = wildRydesService,
    CreateDashboards = true,
    Interval = Duration.Minutes(60), // The interval for the dashboard
    OutlierDetectionAlgorithm = OutlierDetectionAlgorithm.STATIC
});
```
これにより、このワークショップで使用されているメトリクス、アラーム、およびダッシュボードが作成されます。サービスの特性、メトリクスとアラームのデフォルト値を定義し、さらに必要に応じてオペレーションとデフォルト値のオーバーライドを追加します。このコンストラクトは、各オペレーションを単純なHTTPチェックでテストするカナリアを自動的に作成することもできます。または、独自のカナリヤを設定し、メトリクスの詳細とオプションでログファイルについてコンストラクトに指定することもできます。

AZごとのディメンションを持つサービス固有のログとカスタムメトリクスがない場合でも、このコンストラクトを使用してALBとNATゲートウェイのメトリクスを評価し、単一AZの障害を見つけることができます。

```csharp
BasicServiceMultiAZObservability multiAvailabilityZoneObservability = new BasicServiceMultiAZObservability(this, "MultiAZObservability", new BasicServiceMultiAZObservabilityProps() {
    ApplicationLoadBalancers = new IApplicationLoadBalancer[] { loadBalancer },
    NatGateways = new Dictionary<string, CfnNatGateway>() {
        { "us-east-1a", natGateway1},
        { "us-east-1b", natGateway2},
        { "us-east-1c", natGateway3},
    },
    CreateDashboard = true,
    OutlierDetectionAlgorithm = OutlierDetectionAlgorithm.STATIC,
    FaultCountPercentageThreshold = 1.0, // The fault rate to alarm on for errors seen from the ALBs in the same AZ
    PacketLossImpactPercentageThreshold = 0.01, // The percentage of packet loss to alarm on for the NAT Gateways in the same AZ
    ServiceName = "WildRydes",
    Period = Duration.Seconds(60), // The period for metric evaluation
    Interval = Duration.Minutes(60) // The interval for the dashboards
    EvaluationPeriods = 5,
    DatapointsToAlarm = 3
});
```

どちらのオプションもEC2、ECS、Lambda、EKSでのワークロードの実行をサポートしています。コンストラクトの使用方法について詳しく知るには、[GitHubリポジトリ](https://github.com/bamcis-io/multi-az-observability)をご覧ください。

## まとめ
Wild Rydesサービスにおいて、単一AZの障害を検出するために利用可能な可観測性を確認しました。次のラボでは、単一AZへの影響を封じ込める障害境界としてAZを効果的に使用できるように、Wild Rydesのアーキテクチャを更新します。
