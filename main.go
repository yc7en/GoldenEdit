package main

import (
	"context"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 是 Wails 应用实例。一期只占位，后续按 internal/ 各 service 逐步 Bind。
type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) onDomReady() {
	// 前端加载完成后的钩子，后续推送最近文件、vault 状态。
	runtime.EventsEmit(a.ctx, "app:ready")
}

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "GoldenEdit",
		Width:  1280,
		Height: 800,
		AssetServer: &assetserver.Options{
			// 开发期由 Vite 提供；打包期指向 frontend/dist。
		},
		OnStartup:  app.startup,
		OnDomReady: app.onDomReady,
		Bind:       []interface{}{app},
	})
	if err != nil {
		log.Fatal(err)
	}
}
