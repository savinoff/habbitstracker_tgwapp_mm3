{
	email {$CADDY_EMAIL}
}

{$APP_BASE_URL} {
	encode zstd gzip
	reverse_proxy api:3000
}
