---
title : "ラボ7: デプロイメント失敗をシミュレートする"
weight : 80
---

これまでは、レイテンシーを増加させることで障害をシミュレートしてきました。AZIアーキテクチャを構築し、ゾーンシフトを使用することは、他のタイプの障害に対しても有益です。このラボでは、一度に1つのAZにデプロイされる新しいアプリケーションのデプロイメントを作成します。デプロイメントは失敗し、前回のラボと同じようにゾーンシフトを活用して復旧することができます。

::::alert{type="warning" header="ゾーンシフトを終わらせる"} 
前のラボでゾーンシフトを終了していない場合は、終了してください。
::::

## デプロイメントを開始する
まず、CodeDeployに新しいデプロイメントアーティファクトを登録する必要があります。最初に、ワークショップのアセットが含まれているバケットのパスを取得します。これはSSMパラメータに保存されています。[SSMパラメータストアコンソール`(DeploymentAssetパラメータ)`](https://console.aws.amazon.com/systems-manager/parameters/DeploymentAsset/)に移動します。*`Value(値)`* プロパティから文字列をコピーしてください。次のようなものになるはずです

```
s3://ws-assets-us-east-1/e9383b42-6c6f-416b-b50a-9313e476e372/assets/app_arm64_fail.zip
```

次に、[CodeDeployアプリケーションコンソール](https://console.aws.amazon.com/codesuite/codedeploy/applications/multi-az-workshop)に移動します。

![codedeploy-application](/static/codedeploy-application.png)

*`ZonalDeploymentGroup`* という名前のデプロイメントグループをクリックします。その後、*`Create Deployment(デプロイの作成)`* をクリックします。

![create-deployment](/static/create-deployment.png)

先ほど取得したパラメータのS3パスをリビジョンロケーションフィールド(リビジョンの場所)に入力します。

![app-revision](/static/app-revision.png)

*`Additional deployment behavior settings(追加のデプロイ動作設定)`* で *`Overwrite the content(コンテンツの上書き)`* ラジオボタンを選択します。

![app-overwrite](/static/app-overwrite.png)

最後に、画面下部の *`Create deployment(デプロイの作成)`* をクリックします。

アプリケーションは最初のAZの1台のサーバーへのデプロイを開始します。このデプロイメントは、AWS CodeDeployのゾーナルデプロイメントと呼ばれる機能を使用しています。これにより、アプリケーションを一度に1つのAZにデプロイすることができます。これにより、単一AZのインフラストラクチャーイベントと同じ方法で、失敗したデプロイメントに対応することができます。ロールバックはCI/CDシステムの重要な部分ですが、完了までに時間がかかる場合があり、すべての変更をロールバックできるわけではありません。AZからシフトすることは、より単純で迅速な解決策となりえます。また、障害がデプロイメント関連なのか、インフラストラクチャーイベントによるものなのかを、イベント中に貴重な時間を費やして判断する必要がなくなります。詳細については、[AWS CodeDeployを使用した障害分離されたゾーナルデプロイメント](https://aws.amazon.com/blogs/devops/fault-isolated-zonal-deployments-with-aws-codedeploy/)を参照してください。

デプロイメントには数分かかり（通常3.5〜4分程度）、ページ下部で進行状況を確認できます。

![deployment-progress](/static/deployment-progress.png)

最初のインスタンスが完了してから数分後、ページ上部にエラーが表示されてデプロイメントが停止します。

![deployment-error](/static/deployment-error.png)

::::alert{type="info" header="デプロイメントが失敗しない"} 
5 分以上経過してもエラーが表示されない場合は、デプロイメントが停止している可能性があります。現在のデプロイメントを停止して再試行してください。
::::

アラームがトリガーされ、次のAZに移る前に停止したため、デプロイメントが失敗したようです。何が起きているかを観察し、ゾーンシフトを実行する時間を与えるために、デプロイメントは自動的にロールバックするように設定されていません。

## 障害を観察する
Wild Rydesのサービスレベルダッシュボード、*`wildrydes-service-availability-and-latency-<region>`* に戻ります。デプロイメントによってどの操作が影響を受けているか判断できますか？

::::expand{header="ダッシュボードに基づいて、どの操作がどのAZで影響を受けているか判断できますか？"}
*`Pay`* 操作が影響を受けているようです。

![pay-zonal-impact](/static/pay-zonal-impact.png)

この例では、影響は`use1-az2`で発生しています。

![service-zonal-impact](/static/service-zonal-impact.png)
![single-az-fault-count](/static/single-az-fault-count.png)
::::

影響を受けた操作のダッシュボードに移動し、そこで影響を確認します。

::::expand{header="ダッシュボードを確認"}
![pay-dashboard](/static/pay-dashboard.png)
::::

## ゾーンシフトを実行する

前回のラボで実行した手順と同じ手順に従って、影響を軽減するためにゾーンシフトを実行します。特にリージョナルエンドポイントのカナリア可用性メトリクスを確認して、影響が軽減されたことを確認します。影響が軽減されたら（通常、アラームが`OK`状態に戻るまでに約5分かかります）、次のステップに進むことができます。

::::expand{header="ダッシュボードを確認"}
![deployment-recovery-after-shift](/static/deployment-recovery-after-shift.png)
::::

ゾーンシフトの後、失敗したデプロイメントを停止させたアラームが OK 状態に戻るのが確認できるはずです。[CloudWatchアラームコンソールに移動](https://console.aws.amazon.com/cloudwatch/home?#alarmsV2:)し、アラーム名 *`<region>-wildrydes-canary-availability-aggregate-alarm`* を検索してください。

![after-redeployment](/static/after-redeployment.png)

これは、以前のバージョンへのロールバックを開始できることを示しています。

## デプロイメントのロールバック

顧客への影響を軽減したので、環境を復旧するためにデプロイメントをロールバックすることができます。[CodeDeployアプリケーションリビジョン](https://console.aws.amazon.com/codesuite/codedeploy/applications/multi-az-workshop/revisions)に移動します。

*`app_arm64.zip`* のような名前のリビジョンを選択し、*`Deploy application(アプリケーションをデプロイする)`* をクリックします。

![app-revisions](/static/app-revisions.png)

デプロイメントグループ *`ZonalDeploymentGroup`* を選択し、*`Overwrite the content(コンテンツの上書き)`* を選択します。

![deployment-group](/static/deployment-group.png)

最後に、*`Create deployment(デプロイの作成)`* をクリックします。これにより、Auto Scalingグループ内のすべてのインスタンスに以前のバージョンのアプリケーションがロールアウトされます。最初のAZでデプロイメントが完了すると、可用性が100%に戻るはずです。これが再びゾーンシフトを終了できる合図となります。

::::alert{type="info" header="再デプロイ"}
再デプロイメントは、各AZ間にベイク時間を設けながら1インスタンスずつデプロイされます。完了までに最大30分かかる可能性があります。完全なデプロイメントの完了を待つ必要はなく、ゾーンシフトを終了して次のラボに進む前に、最初のAZだけを待てば十分です。また、カナリアに影響を与える一時的な状態により、エラーが発生してアラームがトリガーされ、デプロイメントが停止する可能性もあります。この場合、元のリビジョンを再度デプロイすることができます。最初のAZのインスタンスで成功するだけでよいです。
::::

## 結論

このラボでは、AWS CodeDeployのゾーナルデプロイメントを使用して、問題のある変更の影響を単一のAZに封じ込めました。前回のインフラストラクチャ障害と同じ観察ツールと復旧ツールを、このタイプの障害に対しても使用することができました。本番環境では、この手法を自動ロールバックと組み合わせることで、失敗したデプロイメントの影響を迅速かつ安全に軽減することができます。