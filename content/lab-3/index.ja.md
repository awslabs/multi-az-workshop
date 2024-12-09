---
title : "ラボ3: インフラストラクチャ障害のシミュレーション"
weight : 40
---

このラボでは、単一のAZに影響を与えるグレー障害をシミュレーションします。その後、運用メトリクスとアラームを確認して、どのAZが影響を受けているかを特定できるかを見ていきます。


## Runbookを使用して障害をシミュレーションする

まず、自動化ドキュメントの[AWS Systems Managerコンソール](https://console.aws.amazon.com/systems-manager/automation/execute#)に移動します。

::::alert{type="info" header="AWS リージョンを確認"}
リンクを開くと、ワークショップで使用しているリージョンとは異なるリージョンのAWS SSMコンソールが表示される場合があります。正しいリージョンにいることを確認してください。
::::

*Owned by me* タブを選択します。ここにはワークショップ環境に障害を注入するためのFIS実験を開始する複数のSSMドキュメントがあります。新しいアーキテクチャをテストするために、タイトルに *`addLatency`* が含まれるRunbookを使用しましょう。（これを実行することで、ランダムに選択された1つのAZにおいて、AZ内のインスタンスがデータベースと通信する際にレイテンシーが増加するFIS実験が開始されます。）

![simulate-failure-runbook](/static/add-latency-runbook.png)

コンソール上部の *Execute automation(オートメーションを実行する)* ボタンをクリックします。これにより、自動化ドキュメントの新しいタブが開きます。

![execute-automation](/static/execute-automation.png)

このページでは、*`LatencyExperiments`*のデフォルトの入力パラメータを変更せずに、ページ右下の*Execute*をクリックします。これにより、使用中のAZがランダムに選択され、障害がシミュレートされます。実行には数秒かかり、正常に完了するはずです。

![execute-automation-complete](/static/simulate-failure-runbook-completion.png)

## 障害を観察する

ラボ1で確認したWild Rydesのサービスレベルダッシュボードに戻ります。*`wildrydes-service-availability-and-latency-<region>`* ダッシュボードを選択します。

::::alert{type="info" header="アラームが発報されるまでに時間がかかります"}
アラームの状態が`ALARM`に変わるまでに最大3分かかる場合があります。これは [M of N](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html#alarm-evaluation) 構成を使用しており、3分間で2つのデータポイントを必要とするためです。素早く反応しつつも一時的な問題に過敏に反応しないアラームを作成することは、慎重なバランスが必要です。"2 of 3"や"3 of 5"の構成が一般的です。
::::

待っている間に、運用メトリクスのダッシュボードを自由に探索してください。数分後、「Zonal Isolated Impact Alarm」アラームの1つが`ALARM`状態に移行するはずです。ダッシュボードの更新ボタンを押す必要があるかもしれません。

![dashboard-refresh](/static/dashboard-refresh.png)
![service-az-isolated-impact-alarm](/static/service-az-isolated-impact-alarm.png)

画像の例では、```use1-az6```のAZで障害がシミュレートされました。どの操作が影響を与えているのか確認してみましょう。ダッシュボードの可用性とレイテンシーのセクションの両方を確認してください。この例では、サーバーサイドで測定された`Ride`操作に高レイテンシーの応答が多数あることがわかります。

![service-server-side-single-az-high-latency](/static/service-server-side-single-az-high-latency.png)

カナリアで測定されたレイテンシーまでスクロールすると、同じ問題が顧客体験にも影響を与えていることがわかります。

![service-canary-single-az-high-latency](/static/service-canary-single-az-high-latency.png)

影響を受けている操作を特定したので、サービスレベルで観察された影響が一致するか、そのダッシュボードで確認してみましょう。ダッシュボードのホーム画面に戻り、*`wildrydes-ride-operation-availability-and-latency-<region>`* ダッシュボードを選択します。ここのアラームは、サービスレベルのダッシュボードで見たことを確認しています。リージョンで何かが起きており、影響は`use1-az6`に限定されているようです。

![ride-operation-alarms](/static/ride-operation-alarms.png)

ダッシュボードを下にスクロールして、サーバーサイドのメトリクスを確認してください。追加のレイテンシーが`Ride`操作にどのように影響しているかを確認できるはずです。次に、この障害が`Ride`操作の顧客体験にどのように影響しているかを見るために、カナリアメトリクスまでスクロールしましょう。

![ride-operation-canary-high-latency](/static/ride-operation-canary-high-latency.png)

カナリアのレイテンシーメトリクスを見ると、リージョナルメトリクスと`use1-az6`メトリクスの両方が`ALARM`状態にあることがわかります。これは予想通りです。リージョナルロードバランサーエンドポイントを通じてサービスにアクセスすると、リクエストはロードバランサーがデプロイされている各AZにルーティングされるため、リクエストの33%が障害のあるAZに送信されます。しかし、私たちのAZI実装により、障害が他の2つのAZにカスケードすることを防いでいます。これは私たちが達成したかったことです。問題を解決した後で、これらのメトリクスに戻ってきましょう。

### 複合アラームの定義を確認する
次に、AZへの影響が分離されていることを示す複合アラームの構造を確認します。ダッシュボードの上部にある、Isolated Impactアラームのアラームウィジェットをクリックし、 *`View details page(詳細ページを表示)`* を選択して新しいタブで開きます。(新たらしいタブで開く為、右クリックを利用して開きます)

![alarm-details](/static/alarm-details.png)

サーバーサイドとカナリアの両方のアラームが`ALARM`状態にあることがわかり、両方の観点から障害の影響が確認できます。覚えていらっしゃると思いますが、単一の AZ への影響を特定するためのサーバーサイドアラームの要件の 1 つは、複数のサーバーが影響を受けていることを確認することでした。言い換えれば、そのAZで障害の影響が広範囲に見られることを確認したいということです。そうでなければ、単一の不良インスタンスを交換する方が、より効率的な緩和戦略となります。次のセクションでは、この具体的な要件について探っていきます。

### Contributor Insightsデータを確認する

*`<az>-ride-isolated-impact-alarm-server`* の子アラームのリンクをクリックします。この複合アラームページで、*`<az>-ride-multiple-instances-high-latency-server`*の子アラームのリンクをクリックします。このページで、アラームの*Details(詳細)*ペインにある*Math expression(数式)* を確認します。


![insight-rule-metric-math](/static/insight-rule-metric-math.png)

`INSIGHT_RULE_METRIC` CloudWatchメトリクス数式関数の最初のパラメータは、CloudWatch Contributor Insightルールの名前です。名前は`<az>-ride-per-instance-high-latency-server`の形式になっています。この名前をメモして、[Contributor Insightsコンソール](https://console.aws.amazon.com/cloudwatch/home#contributor-insights:rules)に移動し、その名前のルールを開きます。

![contributor-insight-high-latency](/static/contributor-insight-high-latency.png)

::::alert{type="info" header="グラフの時間範囲"}
障害をシミュレートしてからどれだけ時間が経過したかによって、グラフの詳細をより見やすくするために表示時間範囲を30分等に設定することをお勧めします。
::::

このグラフは、2つのインスタンスが定義されたレイテンシーのしきい値を超える応答を返し始めたことを示しています。これにより、影響が単一のインスタンスだけでないことがわかります。実際、このワークショップでは、影響はそのAZ内のすべてのインスタンスで確認されています。ルールの定義を自由に確認してください。アプリケーションが[Embedded Metric Format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html)（EMF）を使用してCloudWatch Logsを書き込んでいるため、Contributor Insightsを使用することができます。EMFは、構造化ログを生成することと、それらのログからカスタムCloudWatchメトリクスを抽出することの両方に対して単一のアプローチを提供します。これにより、埋め込まれたメトリクスデータに対してCloudWatchダッシュボードとアラームを作成し、さらにContributor Insightsのようなツールでログを照会することが、単一のソリューションで可能になります。EMFは[EC2、ECS、EKS、およびLambda](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Generation_CloudWatch_Agent.html)で実行されているアプリケーションで使用できます。以下は、Wild Rydesフリートのマイクロサービスのログの例です。

```json
{
    "_aws": {
        "Timestamp": 1719073281270,
        "CloudWatchMetrics": [
            {
                "Namespace": "multi-az-workshop/frontend",
                "Metrics": [
                    {
                        "Name": "SuccessLatency",
                        "Unit": "Milliseconds"
                    },
                    {
                        "Name": "Success",
                        "Unit": "Count"
                    },
                    {
                        "Name": "Fault",
                        "Unit": "Count"
                    },
                    {
                        "Name": "Error",
                        "Unit": "Count"
                    },
                    {
                        "Name": "Failure",
                        "Unit": "Count"
                    }
                ],
                "Dimensions": [
                    [
                        "Operation",
                        "Region",
                        "AZ-ID"
                    ],
                    [
                        "Operation",
                        "Region"
                    ]
                ]
            }
        ],
        "LogGroupName": "/multi-az-workshop/frontend"
    },
    "RequestId": "9aeb228b-5833-4c4a-90a2-b4efe86f9bdb",
    "InstanceId": "multi-az-workshop-app-7bfcb9657f-vhscl",
    "Ec2InstanceId": "i-0623c1307f7d06028",
    "AZ": "us-east-1b",
    "HttpStatusCode": 200,
    "Host": "us-east-1c.internal-multi--alb8a-ghkyzldbal7g-1689442580.us-east-1.elb.amazonaws.com",
    "SourceIp": "192.168.0.145",
    "XRayTraceId": "Self=1-6676fa01-2362a70c18704d6560ea5c7f;Root=1-6676f9f4-17945ac70e1cea2158bf253f;Parent=44dc880efaeade3c;Sampled=1;Lineage=00f48b1e:0",
    "TraceId": "00-e59bc76562570eda97f5f003edb009ad-aa6c83f6b69ded41-00",
    "Path": "/home",
    "OneBox": false,
    "Operation": "Home",
    "Region": "us-east-1",
    "AZ-ID": "use1-az4",
    "LogGroupName": "/multi-az-workshop/frontend",
    "SuccessLatency": 18,
    "Success": 1,
    "Fault": 0,
    "Error": 0,
    "Failure": 0
}
```

# 結論
ゾーン障害をシミュレートした後、Wild Rydesのアーキテクチャに加えた変更が、影響の範囲を単一のAZに正しく分離できていることが確認できました。また、アラームは影響を検出し、そのAZがレイテンシーの観点で異常値を示しており、複数のインスタンスが原因となっていることを正しく特定できました。次のラボでは、顧客への影響を軽減するための対策を開始します。
