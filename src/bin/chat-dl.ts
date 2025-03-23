import { json2md, url2json, url2md } from "@/commands";
import yargs from "yargs";

yargs(process.argv.slice(2))
	.command(json2md)
	.command(url2json)
	.command(url2md)
	.demandCommand(1)
	.parse();
