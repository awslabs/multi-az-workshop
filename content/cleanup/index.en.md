---
title : "Cleanup"
weight : 100
---

If you are executing this workshop on your own (not at an AWS event like re\:Invent), please remember to clean up your environment to minimize costs. In order to do so, delete the parent CloudFormation template, `multi-az-workshop`. This will delete all of the child stacks. After the deletion, you may need to delete any remaining CloudWatch Logs log groups that were created by resources.