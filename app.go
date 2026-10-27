package main

import (
	"context"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"github.com/leo/goldenedit/internal/export"
	"github.com/leo/goldenedit/internal/fs"
	"github.com/leo/goldenedit/internal/platform"
	"github.com/leo/goldenedit/internal/settings"
)

// App 聚合所有 Bind 到前端的服务。
type App struct {
	ctx context.Context
	FS      *fs.Service
	Settings *settings.Service
	Export  *export.Service
	Platform *platform.Service
}

func NewApp() *App {
	return &App{
		FS:       fs.NewService(),
		Settings: settings.NewService(),
		Export:   export.NewService(),
		Platform: platform.NewService(),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.FS.Attach(ctx)
	a.Settings.Attach(ctx)
	a.Platform.Attach(ctx)
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
		OnStartup: app.startup,
		Bind: []interface{}{
			app.FS,
			app.Settings,
			app.Export,
			app.Platform,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
