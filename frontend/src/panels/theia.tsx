import React, { useEffect, useRef, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";
import Container from "@material-ui/core/Container";
import Paper from '@material-ui/core/Paper';
import { Client } from '@substrate/playground-api';
import { ErrorMessage, Loading, Wrapper } from '../components';
import { Responder } from '../connect';
import { useLifecycle, restart } from '../lifecycle';
import { LoginPanel } from './login';
import { fetchWithTimeout } from '../utils';

export function TheiaInstance({ client }: { client: Client }) {
    const maxRetries = 5*60;
    const location = useLocation();
    const history = useHistory();
    const [state, send] = useLifecycle(history, location, client);
    const details = state.context.details;
    const ref = useRef();
    const user = details?.user;
    const [data, setData] = useState({ type: "LOADING", phase: "Preparing" });

    useEffect(() => {
        const responder = new Responder(user, o => {
            const el = ref.current;
            if (el) {
                el.contentWindow.postMessage(o, "*")
            } else {
                console.error("No accessible iframe instance");
            }
        });

        const processMessage = o => {
            const {type, data} = o.data;
            switch (type) {
                case "extension-advertise":
                    if (data.online) {
                        responder.announce();
                    } else {
                        responder.unannounce();
                    }
                    break;
                case "extension-online":
                    responder.announce();
                    responder.setStatus(true);
                    break;
                case "extension-offline":
                    responder.setStatus(false);
                    /* TODO ignore offline for now, too trigger happy
                    setData({type: "ERROR", value: "Instance went offline", action: () => navigateToHomepage(history)});
                    responder.unannounce();*/
                    break;
                case "extension-answer-offline":
                case "extension-answer-error":
                    console.error("Error while processing message", o);
                case "extension-answer":
                    // Got an answer from the instance, respond back
                    responder.respond(o.data);
                    break;
                default:
                    console.error(`Unknown instance message type ${type}`, o);
                    break;
            }
        };
        window.addEventListener('message', processMessage, false);
        return () => {
            window.removeEventListener('message', processMessage, false);
            responder.close();
        }
    }, []);

    useEffect(() => {
        async function fetchData() {
            const { result } = await client.getDetails();
            const instance = result.instance;
            if (!instance) {
                // This instance doesn't exist
                setData({ type: "ERROR", value: "Couldn't locate the theia instance", action: () => send(restart) });
                return;
            }

            const phase = instance.pod?.details?.status?.phase;
            if (phase == "Running" || phase == "Pending") {
                const containerStatuses = instance.pod?.details?.status?.containerStatuses;
                if (containerStatuses?.length > 0) {
                    const state = containerStatuses[0].state;
                    const reason = state?.waiting?.reason;
                    if (reason === "CrashLoopBackOff" || reason === "ErrImagePull" || reason === "ImagePullBackOff" || reason === "InvalidImageName") {
                        setData({ type: "ERROR", value: state?.waiting?.message, action: () => send(restart) });
                        return;
                    }
                }
                // Check URL is fine
                const url = instance.url;
                if ((await fetchWithTimeout(url)).ok) {
                    setData({ type: "SUCCESS", url: url });
                    return;
                }
            }

            const retry = data.retry ?? 0;
            if (retry < maxRetries) {
                setTimeout(() => setData({ type: "LOADING", phase: phase, retry: retry + 1 }), 1000);
            } else if (retry == maxRetries) {
                setData({ type: "ERROR", value: "Couldn't access the theia instance in time", action: () => send(restart) });
            }
        }

        if (user && data.type != "ERROR" && data.type != "SUCCESS") {
            fetchData();
        }
    }, [data, user]);

    function Content({data}) {
        if (data.type == 'ERROR') {
            return <ErrorMessage reason={data.value} action={data.action} />;
        } else {
            return <Loading phase={data.phase} retry={data.retry} />;
        }
    }

    if (data.type == "SUCCESS") {
        return <iframe ref={ref} src={data.url} frameBorder="0" width="100%" height="100%"></iframe>
    } else {
        return (
        <Container style={{ display: "flex", flex: 1, justifyContent: "center", alignItems: "center" }}>
            <Paper style={{ display: "flex", flexDirection: "column", height: "60vh", width: "60vw", justifyContent: "center"}} elevation={3}>
                {(details == null || user)
                ? <Content data={data} />
                : <LoginPanel />}
            </Paper>
        </Container>
        );
    }
}

export function TheiaPanel({ client }) {
    const location = useLocation();
    const history = useHistory();
    const [state, send] = useLifecycle(history, location, client);
    const details = state.context.details;

    return (
    <div style={{display: "flex", width: "100vw", height: "100vh"}}>
        <Wrapper send={send} details={details} light={true}>
            <TheiaInstance client={client} />
        </Wrapper>
    </div>
    );
}