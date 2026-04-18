import { dir2md, json2md, url2json, url2md, watch } from "@/commands";
import yargs from "yargs";

yargs(process.argv.slice(2))
	.command(dir2md)
	.command(json2md)
	.command(url2json)
	.command(url2md)
	.command(watch)
	.demandCommand(1)
	.parse();
