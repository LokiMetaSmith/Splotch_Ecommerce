#!/bin/bash
pnpm install
cd server
pnpm install
cd ..
pnpm dev &
sleep 5
