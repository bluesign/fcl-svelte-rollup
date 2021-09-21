<script>
				import * as fcl from "@onflow/fcl";
				fcl.config().put("accessNode.api", "https://access-testnet.onflow.org");

				let message = "";

				async function handleClick() {
				  message = "Waiting for Flow ...";
				  message = await fcl.query({
				    cadence: `
											pub fun main(): String {
															return "Hello from Flow!";
												}
										`
				  });
				}
</script>

<style>
	button {
	  background: #ff3e00;
	  color: white;
	  border: none;
	  padding: 8px 12px;
	  border-radius: 2px;
	}

	.clicked {
	  background: green;
	}
</style>

<button  class:clicked={message} on:click={handleClick} disabled={message}>
  { message ? "Well done!" : "Click this" }
</button>

<div style="margin-top:1rem">
	{message}
</div>