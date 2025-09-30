---
title : "Lab 8: Additional fault experiments"
weight : 90
---

This is an **optional** lab to experiment further with AWS FIS to introduce zonal impact to the application and recover from it with zonal shift. 

::::alert{type="warning" header="End the zonal shift"} 
If you did not end the zonal shift in the previous lab, please do so now.
::::

Here are a few options to try:

1. Run the packet loss experiment.
2. Currently the canary function is set to use an http client timeout of 3 seconds while the server-side database client is set to a timeout of 2 seconds. This means that the canary will usually wait long enough for the timeout error (results in a 5xx response) to propogate from the server to the canary function. What do your metrics look like if the canary times out before the database? Did the packet loss experiment produce results you expected from the canary and server perspectives? Do the results match? You can modify the canary's http client timeout through its environment variable `TIMEOUT` (for example, set it to 1).

![canary-env-var.png](/static/canary-env-var.png)

3. Update the amount of latency (default is 100ms) or packet loss (default is 30%) in the pre-provided experiment templates and observe new behaviors. What level of packet loss was required to consistently produce errors and not just added latency?
4. Run the CPU stress test experiment. 

These options are meant to help you become more familiar with AWS FIS as a self-guided exercise. There are not specific instructions for running these experiements. If you choose not to try these optional experiments, feel free to move on to the summary.
