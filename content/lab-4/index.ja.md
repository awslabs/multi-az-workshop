---
title : "ラボ4: ゾーンシフトを実行する"
weight : 50
---

このラボでは、データプレーンのアクションを使用して影響を受けたAZからトラフィックを移動させることで、AZ障害の影響を軽減します。このパターンの実装では、Amazon Application Recovery Controller（ARC）のゾーンシフトを使用して、単一のアベイラビリティゾーン（AZ）の障害からアプリケーションを確実に復旧します。

AZが障害状態になったことを検出した場合、[ARCのゾーンシフト](https://docs.aws.amazon.com/r53recovery/latest/dg/arc-zonal-shift.html)を開始できます。下記図では、ゾーンシフトは左から3番目のAZに対して実行されます。この操作が完了し、既存のキャッシュされたDNSレスポンスが期限切れになると、新しいリクエストはすべて残りのAZのリソースにのみルーティングされます。

![zonal-shift](/static/zonal-shift.png)

## Amazon Application Recovery Controller（ARC）のゾーンシフト

ゾーンシフトを使用すると、一時的にそのアベイラビリティゾーンからトラフィックを移動させることで、単一のアベイラビリティゾーンの問題から迅速に復旧できます。例えば、不適切なデプロイメントがレイテンシーの問題を引き起こしている場合や、アベイラビリティゾーンが障害状態にある場合に、ゾーンシフトを開始することでアプリケーションを迅速に復旧できます。

すべてのゾーンシフトは一時的なものです。ゾーンシフトを開始する際には、1時間から3日間（72時間）までの初期有効期限を設定する必要があります。ただし、アクティブなゾーンシフトは、いつでも新しい有効期限に更新することができます。新しい有効期限は、設定した時点から開始され、同じ制約が適用されます。

上記図の例において、プライマリデータベースインスタンスが左から3番目のAZにない場合、ゾーンシフトを実行することが、影響を受けたアベイラビリティゾーンでの処理を防ぐための最初の対応として必要な唯一のアクションとなります。プライマリデータベースインスタンスが左から3番目のAZにある場合、Amazon RDSが自動的にフェイルオーバーを行っていない場合は、ゾーンシフトと連携して手動でフェイルオーバーを実行することができます（これはAmazon RDSのコントロールプレーンに依存します）。

このワークショップではAWSマネジメントコンソールを使用してゾーンシフトを実演しますが、本番環境では、シフトを開始するために必要な依存関係を最小限に抑えるため、CLIコマンドまたはAPIを使用してゾーンシフトを開始する必要があります。避難プロセスが単純であるほど、より信頼性が高くなります。具体的なコマンドは、オンコールエンジニアが簡単にアクセスできるローカルのRunbookに保存しておくことができます。ゾーンシフトは、アベイラビリティゾーンを避難させるための最も推奨される、最もシンプルなソリューションです。

## ゾーンシフトを開始する

まず、[Amazon Application Recovery Controller](https://console.aws.amazon.com/route53recovery/home)に移動します。次に、ゾーンシフトのランディングページで、「Zonal Shift(ゾーンレベルの移行)」ラジオボタンを選択し、「Start zonal shift(ゾーンレベルの移行を開始)」をクリックします。

![start-zonal-shift](/static/start-zonal-shift.png)

障害がシミュレートされたAZを選択します。

::::alert{type="info" header="自動化"}
Isolated Impactアラームの説明にデータが含まれていることにも気付いたかもしれません。

![alarm-description](/static/alarm-description.png)

マルチAZ監視ソリューションは、ロードバランサーのARNとAZ IDをアラームの説明にJSONデータとして埋め込みます。これを使用して、オペレーターの介入なしに自動的にゾーンシフトをトリガーすることができます。例えば、アラームでLambda関数をトリガーする場合、アラームの説明は、Lambda関数が受け取る[イベントで配信されるデータ](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html#alarms-and-actions)の一部となります。このデータはイベントから解析され、ゾーンシフトを開始するために使用できます。
::::

ドロップダウンから、トラフィックを移動させたいアベイラビリティゾーンIDを選択します。次に、トラフィックをシフトさせたいロードバランサーをリソーステーブルから選択します。利用可能なロードバランサーは1つだけのはずです。

![zonal-shift-selection](/static/zonal-shift-selection.png)

「Set zonal shift expiration(ゾーンシフトの有効期限を設定)」で、ゾーンシフトの有効期限を選択します。ゾーンシフトの初期有効期限は、1分から最大3日間（72時間）まで設定できます。すべてのゾーンシフトは一時的なものです。有効期限を設定する必要がありますが、後でアクティブなシフトを更新して、最大3日間の新しい有効期限を設定することができます。次に、コメントを入力します。必要に応じて、後でゾーンシフトを更新してコメントを編集することができます。最後に、選択したアベイラビリティゾーンからトラフィックをシフトすることで、アプリケーションの利用可能なキャパシティが減少することを同意するチェックボックスを選択します。*`Start（開始）`* を選択します。

![zonal-shift-start](/static/zonal-shift-start.png)

## ゾーンシフトの仕組み

これがどのように機能するかについて、簡単に説明します。すべてのNLBとALBは、リージョナルDNS Aレコードに加えて、ゾーンごとのDNS Aレコードを持っています。例えば、ロードバランサーは次のようなAレコードを提供します：`my-example-nlb-4e2d1f8bb2751e6a.elb.us-east-1.amazonaws.com`。しかし、ロードバランサーがデプロイされている各AZに対しても、以下のようなAレコードが存在します

```
us-east-1a.my-example-nlb-4e2d1f8bb2751e6a.elb.us-east-1.amazonaws.com
us-east-1b.my-example-nlb-4e2d1f8bb2751e6a.elb.us-east-1.amazonaws.com
us-east-1c.my-example-nlb-4e2d1f8bb2751e6a.elb.us-east-1.amazonaws.com
```

 ロードバランサーリソースに対してゾーンシフトを開始すると、Amazon Application Recovery Controller（ARC）は、指定したアベイラビリティゾーンからトラフィックを移動するようリソースに要求します。この要求により、そのアベイラビリティゾーンのロードバランサーヘルスチェックが異常状態に設定され、ヘルスチェックが失敗します。ヘルスチェックが異常になると、Amazon Route 53はそのリソースに対応するIPアドレスをDNSから除外し、トラフィックがそのアベイラビリティゾーンから転送されます。これにより、新しい接続は、AWSリージョン内の他のアベイラビリティゾーンにルーティングされるようになります。このアクションは、Route 53のデータプレーンを利用して、障害のあるAZからトラフィックを移動させます。

ゾーンシフトを開始すると、ARCでゾーンシフトが作成されますが、プロセスの手順があるため、アベイラビリティゾーンからのトラフィックの移動が即座には確認できない場合があります。また、クライアントの動作と接続の再利用によっては、アベイラビリティゾーン内の既存の進行中の接続が完了するまでに短時間かかる場合があります。ただし、通常はこれには数分程度しかかかりません。

最後に、ゾーンシフトが期限切れになるか、キャンセルすると、ARCはこのプロセスを逆転させ、Route 53のヘルスチェックを再び正常な状態に設定するよう要求します。これにより、元のゾーンのIPアドレスが復元され、そのアベイラビリティゾーンが再びロードバランサーのルーティングに含まれるようになります。

## 運用メトリクスの確認

では、`Ride`操作の運用メトリクスダッシュボードに戻りましょう。

::::alert{type="info" header="メトリクスの反映"}
ゾーンシフトを開始した後、ダッシュボードにメトリクスデータが反映されるまでに5分以上かかる場合があります。
::::

最初に気付くことは、ゾーンの*Isolated Impact*アラームがまだ`ALARM`状態にあることです。

![ride-operation-alarms](/static/ride-operation-alarms.png)

これは、アラームがサーバーサイドのメトリクス*および*カナリアメトリクスの両方によってトリガーされるため、正常で予想される動作です。この場合、`us-east-1c.my-example-alb-4e2d1f8bb2751e6a.elb.us-east-1.amazonaws.com`のようなAZ固有のエンドポイントをテストしているカナリアは、まだ影響を受けています。しかし、リージョナルエンドポイントをテストしているカナリアを見ると、顧客体験への影響がなくなり、アラームが`OK`状態になっていることがわかります。

![post-zonal-shift-canary-latency](/static/post-zonal-shift-canary-latency.png)

ゾーンシフトを開始した後、リージョナルエンドポイントのレイテンシーが影響発生前のレベルに戻りました。これは、ウェブサービスにリージョナルDNSレコードを通じてアクセスする際の顧客体験への影響を、ゾーンシフトが成功的に軽減したことを意味します。

## 環境の復旧
FISコンソールに戻り、開始した実験を見つけます。*`Stop experiment(実験を停止)`* をクリックして実験を終了します。

![stop-experiment](/static/stop-experiment.png)

実験を停止することで、インフラストラクチャーイベントが終了したことをシミュレートしました。数分後、サーバーサイドと影響を受けたAZのカナリアの両方で、レイテンシーが正常に戻ることが確認できます。

![latency-impact-ends](/static/latency-impact-ends.png)
 
これにより、ゾーンシフトを終了して通常運用に戻しても安全だとわかります。ARCゾーンシフトコンソールのタブに戻り、アクティブなゾーンシフトを見つけてゾーンシフトをキャンセルします。

![cancel-zonal-shift](/static/cancel-zonal-shift.png)

ALBのメトリクスを通じて、`use1-az6`でより多くのトラフィックが処理されていることがわかります。これは、ゾーンとリージョンの両方のカナリアテストトラフィックを受け取っているためです。

![alb-processed-bytes-after-shift-ended](/static/alb-processed-bytes-after-shift-ended.png)

## 結論

このラボでは、単一AZの障害による影響を軽減するためにゾーンシフトを開始しました。ロードバランサーのリージョナルDNSレコードを通じてアクセスした場合に、レイテンシーメトリクスが正常に戻ることを確認しました。また、ゾーンのエンドポイントをテストするカナリアが、そのAZでの影響を継続的に確認していることも確認しました。ゾーンシフトを効果的に行うためには、シフトする負荷に対応できるよう事前にスケールしておくことが重要です。そうでない場合、既存のリソースに過負荷がかかる可能性があります。あるいは、追加の負荷に対応するためにそれらの場所でキャパシティを追加している間、サービスを保護するために残りのAZへのトラフィックを一時的に制限またはレート制限する必要があるかもしれません。[ゾーン自動シフト](https://docs.aws.amazon.com/r53recovery/latest/dg/arc-zonal-autoshift.html)の使用を検討してください。これは、ゾーンシフトを実行するためのサービスの準備状態を定期的にテストし、AWSのテレメトリが顧客に影響を与える可能性のあるAZ障害を示した場合に自動的にゾーンシフトを開始します。これにより、サービスの準備が整っているという確信を持つことができ、インシデントからの復旧も速くなります。

::::alert{type="info" header="追加のゾーンシフト統合"}
このバージョンのワークショップでは使用されていませんが、ゾーンシフトは[Amazon EKS](https://docs.aws.amazon.com/eks/latest/userguide/zone-shift.html)および[Amazon EC2 Auto Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-zonal-shift.html)とも統合されており、ロードバランサーのゾーンシフトと併用するか、独立して使用することができます。
::::

次のラボでは、異なるタイプの障害を導入し、アプリケーションがどのように対応するかを確認します。
